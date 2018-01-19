// TODO deal with this hot garbage:
//
// <html><head><script language="javascript">location='/en-us/events/get-social.htm';</script></head><body></body></html>

// reservations/index.html should be:
//
// <script>location = '/reservation/reservation.htm';</script>

console.log('DO NOT FORGET you have to replace the reservation redirector see comments');
var argv = require('boring')();
var Promise = require('bluebird');
var request = require('request-promise');
var fs = require('fs-extra');
var writeFile = Promise.promisify(fs.writeFile, { context: fs });
var cheerio = require('cheerio');
var _ = require('lodash');

var contentTypeToExtension = {
  'text/html': 'html',
  'text/pdf': 'pdf',
  'image/gif': 'gif',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'text/css': 'css',
  'text/javascript': 'js',
  'image/svg+xml': 'svg',
  'font/ttf': 'ttf',
  'application/x-font-woff': 'woff',
  'application/vnd.ms-fontobject': 'eot'
};

var extensionToExtension = {
  'eot': 'eot'
};

var urlAttrs = [ 'href', 'src', 'srcset', 'altsrc', 'data-original', 'data-original-alt' ];

var discoverers = {
  'text/html': function(urls, url, body) {
    body = body.toString('utf8');
    var $ = cheerio.load(body);
    _.each(urlAttrs, function(attr) {
      $('[' + attr + ']').each(function() {
        var $el = $(this);
        var newUrl = $el.attr(attr);
        if (newUrl) {
          newUrl = require('url').resolve(url, newUrl);
          if (allowedUrl(newUrl)) {
            urls.push(newUrl);
          }
        }
      });
    });
  },
  'text/css': function(urls, url, body) {
    var re = /url\(\'(.*?)\'\)/g;
    var matches;
    do {
      matches = re.exec(body);
      if (matches) {
        var newUrl = require('url').resolve(url, matches[1]);
        if (allowedUrl(newUrl)) {
          urls.push(newUrl);
        }
      }
    } while(matches);
    console.log(urls);
  }
}

var rewriters = {
  'text/html': function(url, body) {
    var $ = cheerio.load(body);
    _.each(urlAttrs, fix);
    return $.html();
    function fix(attr) {
      $('[' + attr + ']').each(function() {
        var $el = $(this);
        var newUrl = $el.attr(attr);
        $el.attr(attr, remap(url, newUrl));
      });
    }
  },
  'text/css': function(url, body) {
    return body.replace(/url\(\'(.*?)\'\)/g, function(everything, newUrl) {
      url = url.toString();
      newUrl = newUrl.toString();
      newUrl = require('url').resolve(url, newUrl);
      return 'url(\'' + remap(url, newUrl) + '\')';
    });
  }
}

var seen = {};
var seenPathname = {};
var urlMap = {};
var config;

if (argv._.length === 0) {
  config = 'config.js';
} else {
  config = argv._[0];
}

try {
  config = require(require('path').resolve(process.cwd(), config));
} catch(e) {
  console.error('Unable to read ' + config + ', check for syntax errors and see the documentation');
  console.error(e);
  usage();
}

var allowed = _.map(config.aliases || [], function(alias) {
  return alias.toLowerCase();
});

allowed = _.filter(allowed, function() {
  return allowed.length;
});

var url = config.url;
if (!url) {
  usage('url is required, see the documentation');
}

var parsed = require('url').parse(url);
allowed.push(parsed.hostname.toLowerCase());

var defaultHostname = parsed.hostname;

Promise.try(function() {
  return mirror(url);
}).then(function() {
  console.log(urlMap);
  process.exit(0);
}).catch(function(err) {
  console.error(err);
  process.exit(1);
});

function mirror(url) {
  url = url.toString();
  var parsed = require('url').parse(url);
  var path;
  var folderPath;
  var urls = [];
  var type;
  var body;
  
  if (seen[url]) {
    return;
  }
  seen[url] = true;

  if (!parsed) {
    console.error('Unable to parse: ' + url + ', ignoring');
    return;
  }

  if (!_.includes([ 'http:', 'https:' ], parsed.protocol)) {
    return;
  }

  if (seenPathname[parsed.pathname]) {
    return;
  }
  seenPathname[parsed.pathname] = true;

  console.log(url);

  return Promise.try(function() {
    return Promise.delay(100);
  }).then(function() {
    return get(url);
  }).catch(function(e) {
    console.error('The URL ' + url + ' could not be fetched'); // e
    // There are usually some 404's on a site, so don't bail altogether
    return false;
  }).then(function(response) {
    if (response === false) {
      // We cannot complete this one but it should
      // not propagate as a more global failure
      return;
    }
    type = response.headers['content-type'];
    type = type.replace(/\;.*$/, '');
    var extension = contentTypeToExtension[type];
    if (!extension) {
      var matches = parsed.pathname.match(/\.([^\.\/]+)$/);
      if (matches) {
        extension = extensionToExtension[matches[1] || ''];
      }
      if (!extension) {
        console.error(url + ': have no file extension mapping for the content type: ' + type);
        return;
      }
    }
    path = parsed.pathname;
    if (path.match(/\/[^\.]*$/)) {
      if (!path.match(/\/$/)) {
        path += '/';
      }
      path += 'index.' + extension;
    } else if (path.match(/^\.\w+$/)) {
      path = path.replace(/\.\w+$/, '') + '.' + extension;
    }
    body = response.body;
    urlMap[url] = path;
    // Make sure it can also be remapped from any alias hostname allowed
    _.each(allowed, function(hostname) {
      var parsed = require('url').parse(url);
      delete parsed.host;
      parsed.hostname = hostname;
      urlMap[require('url').format(parsed)] = path;
      console.log('***** remapped ' + require('url').format(parsed) + ' to ' + path);
    });
    path = defaultHostname + path;
    folderPath = path.replace(/[^\/]+$/, '');
    return fs.mkdirp(folderPath).then(function() {
      return writeFile(path, response.body);
    }).then(function() {
      if (discoverers[type]) {
        return discoverers[type](urls, url, body.toString('utf8'));
      }
    }).then(function() {
      // console.log('NOW MIRRORING: ', urls);
      return Promise.mapSeries(urls, mirror);
    }).then(function() {
      if (rewriters[type]) {
        // console.log('rewriting ' + type + ' for ' + url);
        return Promise.try(function() {
          return rewriters[type](url, body.toString('utf8'));
        })
        .then(function(body) {
          return fs.writeFile(path, body);
        });
      }
    });
  });
}

function usage(message) {
  console.error(message + '\n');
  console.error('Usage: mirror-website url');
  process.exit(1);
}

function get(url) {
  return request({
    uri: url,
    resolveWithFullResponse: true,
    encoding: null
  });
}

function remap(url, newUrl) {
  newUrl = require('url').resolve(url, newUrl);
  if (_.has(urlMap, newUrl)) {
    console.log('MAPPED: ' + newUrl + ' -> ' + urlMap[newUrl]);
    return urlMap[newUrl];
  }
  console.log('NO MAP: ' + newUrl);
  return newUrl;
}

function allowedUrl(newUrl) {
  var parsed = require('url').parse(newUrl);
  if (!_.includes(allowed, parsed.hostname)) {
    return false;
  }
  return true;
}