import { Actor, log, LogLevel } from 'apify';

import { setDefaultRequestOptions } from '@esri/arcgis-rest-request';
import { reverseGeocode }           from '@esri/arcgis-rest-geocoding';
import { ApiKey }                   from '@esri/arcgis-rest-auth';

import cheerio         from 'cheerio';
import fetch           from 'node-fetch';
import FormData        from 'isomorphic-form-data';
import htmlEntities    from 'html-entities';
import httpsProxyAgent from 'https-proxy-agent';
import sanitizeHtml    from 'sanitize-html';

setDefaultRequestOptions({ fetch, FormData });

const fkurl = 'https://www.flipkey.com';

Actor.main(
    async function() {
        let gisKey = {};
        if (Object.hasOwn(process.env, 'ARCGIS_API_KEY')) {
            gisKey = new ApiKey({ key: process.env.ARCGIS_API_KEY });
        }
        else {
            log.warning('ArcGIS API key not found - Reverse geocoding disabled');
        }
        const input = await Actor.getInput();
        if (input.verbose) {
            log.setLevel(LogLevel.DEBUG);
        }
        let r = await loadUSCities();
        if (r.status) {
            log.debug(`Total US Cities in database: ${r.uscities.length}`);
            log.debug();
            log.debug(`Supplied raw location: ${input.location}`);
            log.debug(`Supplied radius (mi): ${input.radius}`);
            let ld = await getLocationSuggestion(input.location);
            if (ld.status) {
                log.debug(`Selected name: ${ld.name}`);
                log.debug(`Selected city: ${ld.city}`);
                log.debug(`Selected state: ${ld.state}`);
                log.debug(`Selected url: ${fkurl}/${ld.path}`);
                let c = queryCity(r.uscities, ld.city, ld.state);
                if (c.id) {
                    log.debug(`City found in database: { Latitude: ${c.lat}, Longitude: ${c.lng} }`);
                    log.debug();
                    log.debug('List of nearby cities:');
                    let allNC = queryNearbyCities(r.uscities, c.id, c.lat, c.lng, input.radius);
                    let allNearbyCities = [];
                    await Promise.all(allNC);
                    if (allNC.length) {
                        for (const nc of await Promise.all(allNC)) {
                            let dist = getDistance(c.lat, c.lng, nc.lat, nc.lng);
                            if (nc.status) {
                                allNearbyCities.push(nc);
                                log.debug(`${nc.city}, ${nc.state} (${dist.toFixed(2)} mi) --> ${fkurl}/${nc.path}`);
                            } else {
                                log.debug(`** ${nc.src.toUpperCase()} (${dist.toFixed(2)} mi) --> ${nc.message}`);
                            }
                        }
                        log.debug(`Total nearby cities: ${allNC.length}`);
                        log.debug(`Total nearby cities in FlipKey: ${allNearbyCities.length}`);
                    } else {
                        log.debug('None found');
                    }
                    allNearbyCities.unshift({
                        status: true,
                        message: '',
                        src: input.location,
                        name: ld.name,
                        city: ld.city,
                        state: ld.state,
                        lat: c.lat,
                        lng: c.lng,
                        path: ld.path
                    });
                    log.debug();
                    log.debug('Collecting listings from all available nearby cities...');
                    let allLocationListings = [];
                    for (const nc of await Promise.all(allNearbyCities)) {
                        if (nc.status) {
                            allLocationListings.push(getLocationListings(nc.path, gisKey));
                        }
                    }
                    let uniqueListings = [];
                    for (const ll of await Promise.all(allLocationListings)) {
                        if (ll.status) {
                            for (const l of ll.listings) {
                                if (!uniqueListings.find(
                                    function(v) {
                                        return v.id === this.id;
                                    },
                                    l)) {
                                    uniqueListings.push(l);
                                }
                            }
                        }
                    }
                    let allListingDetails = [];
                    for (const ul of uniqueListings) {
                        allListingDetails.push(getListingDetails(ul.url));
                    }
                    (await Promise.all(allListingDetails)).forEach(
                        function(v, i) {
                            uniqueListings[i].description = v.description;
                            uniqueListings[i].amenities = v.amenities;
                            uniqueListings[i].photos = v.photos;
                            uniqueListings[i].host.name = v.host;
                        }
                    );
                    log.debug();
                    log.debug('Collected listings:');
                    for (const ul of uniqueListings) {
                        let shortName = ul.name;
                        if (shortName.length > 50) {
                            shortName = shortName.substring(0, 50) + '...';
                        }
                        log.debug(`> [${ul.id}] ${shortName} --> ${ul.url}`);
                        log.debug(`> type: '${ul.room.type}'`);
                        log.debug(`> address: ${ul.address}`);
                        log.debug(`> bedrooms: ${ul.room.bedrooms} bathrooms: ${ul.room.baths}`);
                        log.debug(`> latitude: ${ul.coordinates.latitude} longitude: ${ul.coordinates.longitude}`);
                        log.debug(`> price: ${ul.pricing}`);
                        log.debug('> description:');
                        log.debug(ul.description);
                        log.debug('> amenities:');
                        log.debug(JSON.stringify(ul.amenities));
                        log.debug('> photos:');
                        log.debug(JSON.stringify(ul.photos));
                        log.debug(`> host: ${ul.host.name}`);
                        log.debug();
                    }
                    log.debug(`Total listings: ${uniqueListings.length}`);
                    log.debug();
                    await Actor.pushData(uniqueListings);
                } else {
                    throw new Error('Unable to find the city in database');
                }
            } else {
                throw new Error(ld.message);
            }
        } else {
            throw new Error(`Could not load US Cities database: ${r.message}`);
        }
    }
);

async function getAddressFromLatLng(lat, lng, key) {
    let ret = {
        status: false,
        message: '',
        address: ''
    };
    try {
        const res = await reverseGeocode(
            { 
                latitude: lat,
                longitude: lng
            },
            { 
                authentication: key
            }
        );
        if (!Object.hasOwn(res, 'address')) {
            ret.message = 'Unexpected response';
        }
        else if (!Object.hasOwn(res.address, 'Address')) {
            ret.message = 'Unexpected response';
        }
        else {
            let fullAddress = [];
            if (res.address.Address) {
                fullAddress.push(res.address.Address);
                if (res.address.City) {
                    fullAddress.push(res.address.City);
                    if (res.address.Region) {
                        fullAddress.push(res.address.Region);
                        if (res.address.Postal) {
                            fullAddress.push(res.address.Postal);
                        }
                    }
                }
            }
            ret.address = fullAddress.join(', ');
            ret.status = true;
        }
    } catch (err) {
        ret.message = err.message;
    }
    return ret;
}

function getCityAndState(d) {
    let ret = {
        city: '',
        state: ''
    };
    let a = d.split(',', 2);
    a.forEach(
        function(v, i) {
            a[i] = v.trim();
        }
    );
    ret.city = a[0].toUpperCase();
    ret.state = '';
    if (2 == a.length) {
        ret.state = a[1].toUpperCase();
    }
    return ret;
}

function getDistance(lat1, lng1, lat2, lng2) {
    function getRad(deg) {
        return deg * Math.PI / 180;
    }
    const earthRadius = 3958.8;
    let difLat = getRad(lat2 - lat1);
    let difLng = getRad(lng2 - lng1);
    lat1 = getRad(lat1);
    lat2 = getRad(lat2);
    let a = Math.pow(Math.sin(difLat / 2), 2) + Math.pow(Math.sin(difLng / 2), 2) * Math.cos(lat1) * Math.cos(lat2);
    let c = 2 * Math.asin(Math.sqrt(a));
    return earthRadius * c;
}

async function getHTTPResponse(url) {
    let config = {};
    if (Object.hasOwn(process.env, 'APIFY_IS_AT_HOME')) {
        const proxyConfig = await Actor.createProxyConfiguration({groups: ['RESIDENTIAL']});
        const proxyAgent = new httpsProxyAgent(await proxyConfig.newUrl());
        config = {
            agent: proxyAgent
        };
    }
    return fetch(url, config);
}

async function getListingDetails(url) {
    let ret = {
        status: false,
        message: '',
        description: '',
        amenities: [],
        photos: [],
        host: ''
    };
    try {
        const res = await getHTTPResponse(url);
        if (200 != res.status) {
            ret.message = `Unexpected response code: ${res.status}`;
        } else if (-1 == res.headers.get('content-type').indexOf('text/html')) {
            ret.message = `Unexpected content type: ${res.headers.get('content-type')}`;
        } else {
            const page = cheerio.load(await res.text());
            const less = page('#descHome > div.less-content'),
                  more = page('#descHome > div.more-content');
            if (less.length) {
                let html = less.html();
                if(more.length) {
                    html += more.html();
                }
                ret.description = sanitizeHtml(
                    html,
                    {
                        allowedTags: [
                            'ul', 'li', 'b', 'i', 'strong', 'p', 'br', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'
                        ]
                    }
                );
            }
            page('#description > div.content-block > div.feature-group').each(
                function() {
                    if (0 == page(this).text().trim().indexOf('Amenities')) {
                        page(this).children('ul').children('li').each(
                            function() {
                                ret.amenities.push(page(this).text().trim());
                            }
                        );
                        page(this).children('.more-content').children('ul').children('li').each(
                            function() {
                                ret.amenities.push(page(this).text().trim());
                            }
                        );
                        return false;
                    }
                }
            );
            page('#wide-carousel-list > div > div.slick-bg > img.slick-img').each(
                function() {
                    let url = page(this).attr('src');
                    if (!url) {
                        url = page(this).attr('data-lazy');
                    }
                    if (url) {
                        url = url.trim();
                        if (0 != url.indexOf('https://')) {
                            if (0 == url.indexOf('//')) {
                                url = 'https:' + url;
                            } else {
                                url = 'https://' + url;
                            }
                        }
                        ret.photos.push(url);
                    }
                }
            );
            const owner = page('#bookingWith > div.content-block > div.content-wrap > div.owner-data');
            if (owner.length) {
                if (owner.children().length) {
                    ret.host = owner.children().first().text().trim();
                }
            }
            ret.status = true;
            let missing = [];
            if (!ret.description.length) {
                missing.push('description');
            }
            if (!ret.amenities.length) {
                missing.push('amenities');
            }
            if (!ret.photos.length) {
                missing.push('photos');
            }
            if (!ret.host.length) {
                missing.push('host');
            }
            if (missing.length) {
                ret.message = `Missing listing fields: ${JSON.stringify(missing)}`;
            }
        }
    } catch (err) {
        ret.message = err.message;
    }
    return ret;
}

async function getLocationListings(path, key) {
    let ret = {
        status: false,
        message: '',
        listings: []
    };
    let eof = false;
    let page = 1;
    for (;;) {
        try {
            const res = await getHTTPResponse(fkurl + '/content/srp/srp_fk/index_json/' + path + '?page=' + page);
            if (200 != res.status) {
                ret.message = `Unexpected response code: ${res.status}`;
            } else if (-1 == res.headers.get('content-type').indexOf('application/json')) {
                ret.message = `Unexpected content type: ${res.headers.get('content-type')}`;
            } else {
                let lr = (await res.json()).results;
                if (!lr) {
                    ret.message = 'Unexpected content: listings not found';
                } else if (!Array.isArray(lr)) {
                    ret.message = 'Unexpected content: results is not an array';
                } else {
                    ret.status = true;
                    if (lr.length) {
                        for (const l of lr) {
                            if (l.isListing) {
                                let sanitizedName = htmlEntities.decode(
                                    sanitizeHtml(
                                        l.homeName.replace(/\s/g, ' '),
                                        {
                                            allowedTags: []
                                        }
                                    )
                                );
                                let decodedAddress = '';
                                if (Object.keys(key).length) {
                                    const res = await getAddressFromLatLng(l.lat, l.lon, key);
                                    if (res.status) {
                                        decodedAddress = res.address;
                                    } else {
                                        log.warning(res.message);
                                    }
                                }
                                let bedroomCount = parseInt(l.bedroomCountText, 10);
                                let bathroomCount = parseInt(l.bathroomCountText, 10);
                                if (isNaN(bedroomCount)) {
                                    bedroomCount = 0;
                                }
                                if (isNaN(bathroomCount)) {
                                    bathroomCount = 0;
                                }
                                ret.listings.push({
                                    id: l.homeId.toString(),
                                    name: sanitizedName,
                                    url: l.advPageUrl,
                                    description: '',
                                    address: decodedAddress,
                                    room: {
                                        type: l.homeType,
                                        bedrooms: bedroomCount,
                                        baths: bathroomCount
                                    },
                                    coordinates: {
                                        latitude: l.lat,
                                        longitude: l.lon
                                    },
                                    pricing: l.ttPrice,
                                    amenities: [],
                                    photos: [],
                                    host: {
                                        name: ''
                                    }
                                });
                            }
                        }
                    } else {
                        eof = true;
                    }
                }
            }
        } catch (err) {
            ret.message = err.message;
        }
        if (ret.status) {
            if (eof) {
                break;
            } else {
                ret.status = false;
            }
        } else {
            break;
        }
        page++;
    }
    return ret;
}

async function getLocationSuggestion(l, lat = 0, lng = 0) {
    let ret = {
        status: false,
        message: '',
        src: l,
        name: '',
        city: '',
        state: '',
        lat: lat,
        lng: lng,
        path: ''
    };
    let cs = getCityAndState(l);
    try {
        const res = await getHTTPResponse(fkurl + '/content/srp/saut?s=' + cs.city);
        if (200 != res.status) {
            ret.message = `Unexpected response code: ${res.status}`;
        } else if (-1 == res.headers.get('content-type').indexOf('application/json')) {
            ret.message = `Unexpected content type: ${res.headers.get('content-type')}`;
        } else {
            let er = await res.json();
            if (!Array.isArray(er)) {
                ret.message = 'Unexpected content: returned JSON data is not an array';
            } else if (!er.length) {
                ret.message = 'Unexpected content: search results are empty';
            } else {
                let name, path;
                if (cs.state) {
                    let fullName = `${cs.city}, ${cs.state}, UNITED STATES`;
                    for (const e of er) {
                        if (fullName === e.Name.toUpperCase()) {
                            name = fullName;
                            path = e.SlashName;
                            break;
                        }
                    }
                } else {
                    name = res.json()[0].Name.toUpperCase();
                    path = res.json()[0].SlashName;
                }
                if (name) {
                    let cs = getCityAndState(name);
                    ret.status = true;
                    ret.name = name;
                    ret.city = cs.city;
                    ret.state = cs.state;
                    ret.path = path;
                } else {
                    ret.message = 'Unable to pick a suitable suggestion';
                }
            }
        }
    } catch (err) {
        ret.message = err.message;
    }
    return ret;
}

async function loadUSCities() {
    let ret = {
        status: false,
        message: '',
        uscities: []
    };
    const jsonURL = 'https://api.npoint.io/e53b0fd5a237603e0f09';
    try {
        const res = await fetch(jsonURL);
        if (200 != res.status) {
            ret.message = `Unexpected response code: ${res.status}`;
        } else if (-1 == res.headers.get('content-type').indexOf('application/json')) {
            ret.message = `Unexpected content type: ${res.headers.get('content-type')}`;
        } else {
            let cr = await res.json();
            if (!Array.isArray(cr)) {
                ret.message = `Unexpected content: downloaded JSON is not an array`;
            } else if (!cr.length) {
                ret.message = 'Unexpected content: downloaded array is empty';
            } else {
                ret.uscities = cr;
                ret.status = true;
            }
        }
    } catch (err) {
        ret.message = err.message;
    }
    return ret;
}

function queryCity(db, city, state) {
    let ret = {
        id: 0,
        lat: 0,
        lng: 0
    };
    for (const c of db) {
        if (c.city_ascii.toUpperCase() === city.toUpperCase()) {
            if (c.state_name.toUpperCase() === state.toUpperCase()) {
                ret.id = c.id;
                ret.lat = c.lat;
                ret.lng = c.lng;
            } else if (c.state_id.toUpperCase() === state.toUpperCase()) {
                ret.id = c.id;
                ret.lat = c.lat;
                ret.lng = c.lng;
            }
        }
    }
    return ret;
}

function queryNearbyCities(db, id, lat, lng, radius) {
    let ret = [];
    for (const c of db) {
        if (c.id !== id) {
            let dist = getDistance(lat, lng, c.lat, c.lng);
            if (radius >= dist) {
                let nearbyLocation = `${c.city_ascii}, ${c.state_name}`;
                ret.push(getLocationSuggestion(nearbyLocation, c.lat, c.lng));
            }
        }
    }
    return ret;
}