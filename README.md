## Why another mirroring tool?

Have you seen websites lately? Every single one is a special snowflake with unusual requirements if you are going to mirror it as a static site. `mirror-website` is designed from the beginning with the expectation that you'll need to write some code for those cases. And `mirror-website` makes it really easy to do that.

## Installation

`npm install -g mirror-website`

## Usage

Create a folder for your mirror and create a `config.js` file there. Make sure you export a `sites` property, which should be an array in which every entry has a `url` property and, optionally, `aliases` (an array of hostnames considered equivalent to the main one).

Then run:

`node app`

This creates a subdirectory in the current directory named after the domain name in your URL.

Here is a fancy example of what can be done in your own `config.js` file to address special cases:

```javascript
var _ = require('lodash');
var cheerio = require('cheerio');
var fs = require('fs');

module.exports = {

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
    discoverers: {
      $append: [
        {
          // Discover URLs in special HTML pages that just do browser side redirects.
          // Push them onto the urls array to make sure they get crawled
          type: 'text/html',
          function: function(urls, url, body) {
            var matches = body.match(/location=\'(.*?)\'/);
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
          // Replace contact forms with a mailto link and
          // instructions to provide the same fields (remember,
          // this is a static site now; mailto: forms do not
          // really work anymore in 2017)
          type: 'text/html',
          function: function(url, body) {
            var $ = cheerio.load(body);
            var $old = $('form.fancy');
            if (!$old.length) {
              return body;
            }
            var mailto = $old.attr('emailto');
            var $link = $('<p style="margin-top: 32px"><a>Please reach out via email to ' + mailto + '.</a></p>');
            $link.find('a').attr('href', 'mailto:' + mailto);
            var $prompt = $('<p style="margin-top: 32px">Be sure to include the following information:</p>');
            var $list = $('<ul></ul>');
            var venue = $('title').text().replace(/^[\s\S]*\|\s*/, '');
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
            var $new = $('<div></div>');
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

  // Custom callback to modify the config for each site before it actually gets mirrored
  init: function(config) {
    // Change foo.com into just foo, so we do not add domain names
    // when creating folders, and use a "sites/" parent folder
    config.folder = 'sites/' + config.folder.replace(/\.[^/]+$/, '');
  }
};
```

## If `config.js` doesn't float your boat

You can specify another filename on the command line.

