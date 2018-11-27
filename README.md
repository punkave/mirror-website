## Why another mirroring tool?

Have you seen websites lately? Every single one is a special snowflake with unusual requirements if you are going to mirror it as a static site. `mirror-website` is designed from the beginning with the expectation that you'll need to write some code for those cases. And `mirror-website` makes it really easy to do that.

## Usage

1. Create your own project, with `git init` and `npm init`, in the usual way. Also `npm install` tools like `lodash` and `cheerio` that you may wish to use.
2. `npm install mirror-website`
3. Write your `app.js`. You'll write `preprocessors` (which modify the markup first), `discoverers` (which seek out URLs to be mirrored), and `rewriters` (your last chance to modify the markup). Here are some examples.

Note the use of `$append`. Without this, you're replacing all of the standard preprocessors, discoverers and rewriters bundled with `mirror-website`. You probably don't want to do that.

```javascript
```javascript
const _ = require('lodash');
const cheerio = require('cheerio');
const fs = require('fs');
const mirror = require('mirror-website');

mirror({

  // Define the sites to be mirrored. We can override properties for
  // individual sites in these objects too, the stuff in "defaults"
  // applies to all of them
  sites: [
    { url: "http://example1.com" },
    { url: "http://example2.com" },
    { url: "http://example3.com" },
    { url: "http://example4.com" }
  ],

  // Config settings for all sites
  defaults: {
    aliases: [
      'some-cdn-that-must-get-mirrored-too-for-every-site.com'
    ],
    // Some special attributes that also carry URLs for this set of sites
    urlAttrs: {
      $append: [ 'altsrc', 'data-original', 'data-original-alt' ]
    },
    preprocessors: {
      $append: [
        // A chance to modify the body before any URL discoverers run
        function(url, body) {
          // modify body, then...
          return body;
        }
      ]
    },
    discoverers: {
      $append: [
        {
          // Discover URLs in special HTML pages that just do browser side redirects.
          // Push them onto the urls array to make sure they get crawled
          type: 'text/html',
          function: function(urls, url, body) {
            const matches = body.match(/location=\'(.*?)\'/);
            if (matches) {
              urls.push(matches[1]);
            }
          }
        }
      ]
    },
    rewriters: {
      $append: [
        {
          // Work around a problem with a redirect page
          type: 'text/html',
          function: function(url, body) {
            if (!url.match(/examples$/)) {
              return body;
            }
            return '<script>location = \'/example/example.htm\';</script>';
          }
        },
        {
          // Replace custom contact forms found on a particular
          // site with a mailto link and instructions to
          // provide the same fields. This logic is specific to
          // the sites I was mirroring that day. The point is
          // to give you the same flexibility

          type: 'text/html',

          function: function(url, body) {
            const $ = cheerio.load(body);
            const $old = $('form.fancy');
            if (!$old.length) {
              return body;
            }
            const mailto = $old.attr('emailto');
            const $link = $('<p style="margin-top: 32px"><a>Please reach out via email to ' + mailto + '.</a></p>');
            $link.find('a').attr('href', 'mailto:' + mailto);
            const $prompt = $('<p style="margin-top: 32px">Be sure to include the following information:</p>');
            const $list = $('<ul></ul>');
            const venue = $('title').text().replace(/^[\s\S]*\|\s*/, '');
            if (venue) {
              var $item = $('<li></li>');
              $item.text('Name of venue: ' + venue);
            } else {
              $item.text('Name of venue');
            }
            $list.append($item);
            $old.find('label').each(function() {
              var $item = $('<li></li>');
              $item.text($(this).text());
              $list.append($item);
            });
            const $new = $('<div></div>');
            $new.append($link);
            $new.append($prompt);
            $new.append($list);
            $old.replaceWith($new);
            return $.html();
          }
        },
      ]
    }
  },

  // Custom callback to modify the config for each site
  // before it actually gets mirrored
  init: function(config) {
    // Change foo.com into just foo, so we do not add domain names
    // when creating folders, and use a "sites/" parent folder
    config.folder = 'sites/' + config.folder.replace(/\.[^/]+$/, '');
  }
}).then(function() {
  console.log('Done!');
})
```

Note that the configuration object must have a `sites` property, which should be an array in which every entry has a `url` property and, optionally, `aliases` (an array of hostnames considered equivalent to the main one).

You can also set properties like `aliases` under a `defaults` key, which applies to every site.

Then run your application:

```
node app
```

This creates a subdirectory in the current directory named after the domain name in your URL.

## Changelog

2.0.0: abandoned global install in favor of a library for better maintainability and error messages.
1.0.1: `request` dependency for `request-promise`.
