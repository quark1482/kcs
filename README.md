# KCS - KeyChain scraper
Apify actor for scraping listings from flipkey.com.


Features
--------

* Extracts all listings for a location, within a given radius.
* Gets relevant details (price, rooms, amenities, etc.) for every listing.
* Provides an estimated address of the actual property.


Installation
------------

### Running the actor in the [Apify console](https://console.apify.com/):

1. Go to Actors, hit 'Create new' and then 'Link Git repository'.
<br>Use this URL: ` https://github.com/quark1482/kcs `.
2. Hit 'Import actor'.
3. *[optional]* Give it a Title/Unique name/Description.
4. Hit 'Build'.
5. Hit the 'Input' tab and fill out these fields:
    - Location
<br>Required. Use the format *city, state*.
    - Radius
<br>In miles. **The number of results increases EXPONENTIALLY as the radius increases**.
<br>Have this into account for a correct usage limits in your subscribed services.
    - Verbose mode
<br>Enable it, in case you want to see the progress/status of the actor.
6. *[optional]* Hit the 'Code' tab and add an environment variable to store your ArcGIS REST API key:
    - Name: `ARCGIS_API_KEY`
    - Value: [Get it here](https://github.com/quark1482/kcs/edit/main/README.md#optional-using-the-arcgis-location-services).
    - Secret: YES
7. Hit 'Start'.
8. The [results](https://github.com/quark1482/kcs/edit/main/README.md#results) will be found in the 'Last run' tab. Once there, hit the 'Dataset' tab.

### Running the actor locally:

1. Follow the steps to install the Apify CLI [here](https://github.com/apify/apify-cli#readme).
2. *[optional]* If you have an [ArcGIS API key](https://github.com/quark1482/kcs/edit/main/README.md#optional-using-the-arcgis-location-services)...
    - `apify secrets:add ArcGIS <your-api-key-value>`
3. `cd` to any directory where you want to put the actor source code in...
    - `git clone https://github.com/quark1482/kcs`
    - `cd kcs`
    - `npm install`
    - `mkdir storage`
    - `mkdir storage/key_value_stores`
    - `mkdir storage/key_value_stores/default`
    - `cd storage/key_value_stores/default`
    - Enter a wanted location. Let's say it's 'Boston'. Follow the guidelines [here](https://github.com/quark1482/kcs/edit/main/README.md#running-the-actor-in-the-apify-console).
<br>`echo '{ "location": "Boston, Massachusetts", "radius": 10, "verbose": true }' > INPUT.json`
    - `cd ../../..`
    - `apify run`
4. The [results](https://github.com/quark1482/kcs/edit/main/README.md#results) will be found in the directory `./storage/datasets/default`.

### *[optional]* Using the ArcGIS location services:

1. Create a [ArcGIS developer](https://developers.arcgis.com/) account.
2. Go to the Dashboard and create a new API key (or use the default one).
3. Hit 'Edit API Key' and then 'Set service scopes'.
4. Check 'Geocoding (not stored)' and disable the others if you wish, and hit 'Apply 1 scope'. 
5. *[optional]* Hit the 'Settings' tab and give your key a Title/Description and hit 'Save settings'.

Now you have an API key value ready to use in the 'Overview' tab.
<br>Have this page at hand for copying the value later.

*The free service will give you 20K geocoding requests by month*.
<br>In other words, ~20K resolved addresses without a subscription.


Results
-------

The listing details are returned as an array of JSON objects.
<br>The Apify console allows you to export them in other formats like CSV, XML, etc.
<br>If you are running the actor [locally](https://github.com/quark1482/kcs/edit/main/README.md#running-the-actor-locally), one JSON file is created per listing.

The JSON listing objects have this structure:

```
{
    "id": "<flipkey.com internal listing id>",
    "name": "<listing short name>",
    "url": "direct link to the listing",
    "description": "<listing description, with HTML tags>",
    "address": "<property address, if geolocation was configured>",
    "room": {
        "type": "<House, apartment, etc.>",
        "bedrooms": <number of bedrooms>,
        "baths": <number of baths>
    },
    "coordinates": {
        "latitude": <GPS latitude of the property>,
        "longitude": <GPS longitude of the property>
    },
    "pricing": <price per night>,
    "amenities": [
        "<array of amenity names>",
        "<like Internet access>",
        "<or Fridge>",
        "<or Satellite TV>",
	"<etc>"
    ],
    "photos": [
        "<array of direct links to every photo of the property>"
    ],
    "host": {
        "name": "<name of the host (as they decided to be shown)>"
    }
}
```

Suggestions? Additions? Drop me [a line](mailto:quark1482@protonmail.com?subject=[GitHub]%20KeyChain%20scraper) with your comments. :slightly_smiling_face:


Dependencies
------------

* [apify](https://github.com/apify/apify-sdk-js)
<br>For obvious reasons, the Apify SDK.
<br>`npm i apify`

* [cheerio](https://github.com/cheeriojs/cheerio)
<br>For manipulating the HTML DOM.
<br>`npm i cheerio`

* [node-fetch](https://github.com/node-fetch/node-fetch)
<br>For requesting HTTP resources (also required by the ArcGIS REST API).
<br>`npm i node-fetch`

* [isomorphic-form-data](https://github.com/form-data/isomorphic-form-data)
<br>For encoding multipart/form-data payloads (required by the ArcGIS REST API).
<br>`npm i isomorphic-form-data`

* [html-entities](https://github.com/mdevils/html-entities)
<br>For encoding/decoding HTML special characters.
<br>`npm i html-entities`

* [https-proxy-agent](https://github.com/TooTallNate/node-https-proxy-agent)
<br>For connecting to HTTP(S) proxies.
<br>`npm i https-proxy-agent`

* [sanitize-html](https://github.com/apostrophecms/sanitize-html)
<br>For striping HTML content from unwanted elements.
<br>`npm i sanitize-html`

* [ArcGIS REST JS](https://esri.github.io/arcgis-rest-js/guides/node/)
<br>For reverse-geocoding requests to the ArcGIS REST API.
<br>`npm i @esri/arcgis-rest-auth@"<4" @esri/arcgis-rest-geocoding@"<4" @esri/arcgis-rest-request@"<4"`
<br>_As you may have noticed, there is an issue with the newest ArcGIS modules. Hence the version lock._


ToDo's
------

- [ ] Limit the rate of the requests to avoid HTTP 429 statuses.
- [ ] Solve the dependency errors in the ArcGIS modules (v4 and up).


_Notice_
--------

As you may already know, the target website shows a map with an approximate location for each property.
<br>To do that, it uses (_internally_) the respective latitude and longitude with the Maps service (Google).
<br>The coordinates, which are not exposed in the website, are used by this actor for reverse geolocation.
<br>_There could be some privacy considerations here_.

If anything, the scraped addresses are not exact. They can point you to the right street, but that's all.
<br>AFAIK, unless the property is known nation-wide, there is no service capable of pointing right at its door.


<br><br>
_This README file is under construction._