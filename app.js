var argv = require('boring')();
var Promise = require('bluebird');
var request = require('request-promise');
var fs = require('fs-extra');
var writeFile = Promise.promisify(fs.writeFile, { context: fs });
var cheerio = require('cheerio');
var _ = require('lodash');

var configFile;
if (argv._.length === 0) {
  configFile = 'config.js';
} else {
  configFile = argv._[0];
}

try {
  configFile = require(require('path').resolve(process.cwd(), configFile));
} catch(e) {
  console.error('Unable to read ' + argv._[0] + ', check for syntax errors and see the documentation');
  console.error(e);
  usage();
}

if (!configFile.sites) {
  usage('The config file must have a sites array property.');
}

return Promise.mapSeries(configFile.sites, mirrorSite).then(function() {
  console.log('All sites mirrored.');
  process.exit(0);
}).catch(function(e) {
  console.error('An error occurred during mirroring:', e);
  process.exit(1);
});

function mirrorSite(site) {

  var seen = {};
  var seenPathname = {};
  var urlMap = {};

  var config = {
    aliasWww: true,
    contentTypeToExtension: {
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
      'application/vnd.ms-fontobject': 'eot',
      'application/pdf': 'pdf',
      'image/x-icon': 'ico',
      'application/javascript': 'js'
    },
    extensionToExtension: {
      'eot': 'eot'
    },
    urlAttrs: [ 'href', 'src', 'srcset' ],
    discoverers: [
      {
        type: 'text/html',
        function: function(urls, url, body) {
          var $ = cheerio.load(body);
          _.each(config.urlAttrs, function(attr) {
            $('[' + attr + ']').each(function() {
              var $el = $(this);
              var newUrl = $el.attr(attr);
              if (newUrl) {
                urls.push(newUrl);
              }
            });
          });
        }
      },
      {
        type: 'text/css',
        function: function(urls, url, body) {
          var re = /url\(\'(.*?)\'\)/g;
          var matches;
          do {
            matches = re.exec(body);
            if (matches) {
              urls.push(matches[1]);
            }
          } while(matches);
        }
      }
    ],
    rewriters: [
      {
        type: 'text/html',
        function: function(url, body) {
          var $ = cheerio.load(body);
          _.each(config.urlAttrs, fix);
          // console.log($.html());
          // process.exit(1);
          return $.html();
          function fix(attr) {
            $('[' + attr + ']').each(function() {
              var $el = $(this);
              var newUrl = $el.attr(attr);
              $el.attr(attr, remap(url, newUrl));
            });
          }
        }
      },
      {
        type: 'text/css',
        function: function(url, body) {
          return body.replace(/url\(\'(.*?)\'\)/g, function(everything, newUrl) {
            url = url.toString();
            newUrl = newUrl.toString();
            newUrl = require('url').resolve(url, newUrl);
            return 'url(\'' + remap(url, newUrl) + '\')';
          });
        }
      }
    ]
  };

  merge(config, _.clone(configFile.defaults));
  merge(config, _.omit(argv, '_'));
  merge(config, site);

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

  if (config.aliasWww) {
    if (parsed.hostname.match(/^www\./)) {
      allowed.push(parsed.hostname.replace(/^www\./, ''));
    } else {
      allowed.push('www.' + parsed.hostname);
    }
  }

  var defaultHostname = parsed.hostname;

  if (!config.folder) {
    config.folder = defaultHostname;
  }

  if (configFile.init) {
    configFile.init(config);
  }
  
  return Promise.try(function() {
    return mirror(url);
  });

  function mirror(url) {
    // console.log('mirroring ' + url);
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

    return Promise.try(function() {
      return Promise.delay(100);
    }).then(function() {
      return get(url);
    }).catch(function(e) {
      console.error('The URL ' + url + ' could not be fetched');
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
      var extension = config.contentTypeToExtension[type];
      if (!extension) {
        var matches = parsed.pathname.match(/\.([^\.\/]+)$/);
        if (matches) {
          extension = config.extensionToExtension[matches[1] || ''];
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
      });
      path = config.folder + path;
      folderPath = path.replace(/[^\/]+$/, '');
      return fs.mkdirp(folderPath).then(function() {
        return writeFile(path, response.body);
      }).then(function() {
        return Promise.mapSeries(config.discoverers, function(discoverer) {
          if (type !== discoverer.type) {
            return;
          }
          return Promise.try(function() {
            return discoverer.function(urls, url, body.toString('utf8'));
          });
        });
      }).then(function() {
        urls = _.map(urls, function(newUrl) {
          return require('url').resolve(url, newUrl);
        });
        urls = _.filter(urls, allowedUrl);
        return Promise.mapSeries(urls, mirror);
      }).then(function() {
        var some = false;
        return Promise.mapSeries(config.rewriters, function(rewriter) {
          if (type !== rewriter.type) {
            return;
          }
          some = true;
          return Promise.try(function() {
            return rewriter.function(url, body.toString('utf8'))
          }).then(function(_body) {
            body = _body;
            some = true;
          });
        }).then(function() {
          if (some) {
            return fs.writeFile(path, body);
          }
        });
      });
    });
  }

  function get(url, _retries) {
    return request({
      uri: url,
      resolveWithFullResponse: true,
      encoding: null
    }).catch(function(e) {
      if (!_retries) {
        _retries = 0;
      }
      if (e.statusCode >= 500) {
        retries++;
        if (retries >= 10) {
          throw e;
        }
        return Promise.delay(1000).then(function() {
          console.log('RETRYING: ' + url);
          return get(url, retries);
        });
      }
      throw e;
    });
  }

  function remap(url, newUrl) {
    newUrl = require('url').resolve(url, newUrl);
    var hashAt = newUrl.indexOf('#');
    var hash = '';
    var path;
    if (hashAt !== -1) {
      hash = newUrl.substr(hashAt);
      path = newUrl.substr(0, hashAt);
    } else {
      path = newUrl;
    }
    if (_.has(urlMap, path)) {
      return urlMap[path] + hash;
    }
    return newUrl;
  }

  function allowedUrl(newUrl) {
    var parsed = require('url').parse(newUrl);
    if (!_.includes(allowed, parsed.hostname)) {
      return false;
    }
    return true;
  }
}

function usage(message) {
  console.error(message + '\n');
  console.error('Usage: mirror-website url');
  process.exit(1);
}

function merge(target, from) {
  _.each(from, function(val, key) {
    if (val && val.$append) {
      target[key] = target[key] || [];
      target[key] = target[key].concat(val.$append);
    } else if (val && val.$merge) {
      target[key] = target[key] || {};
      _.merge(target[key], val.$merge);      
    } else {
      target[key] = val;
    }
  });
}
