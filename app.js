const argv = require('boring')();
const Promise = require('bluebird');
const request = require('request-promise');
const fs = require('fs-extra');
const writeFile = Promise.promisify(fs.writeFile, { context: fs });
const cheerio = require('cheerio');
const _ = require('lodash');

module.exports = function(userConfig) {

  if (!userConfig.sites) {
    throw new Error('The config object must have a sites array property.');
  }

  return Promise.mapSeries(userConfig.sites, mirrorSite);

  function mirrorSite(site) {

    const seen = {};
    const seenPathname = {};
    const urlMap = {};

    const config = {
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
      preprocessors: [
        {
          // If there is a base tag, rewrite the URLs
          // and remove it to simplify literally
          // everything else
          type: 'text/html',
          function(url, body) {
            const $ = cheerio.load(body);
            const $base = $('base');
            if (!$base.length) {
              return body;
            }

            const href = $base.attr('href');
            if (!href) {
              return body;
            }

            $base.remove();

            const relativeTo = require('url').resolve(url, href);
            _.each(config.urlAttrs, function(attr) {
              $('[' + attr + ']').each(function() {
                const $el = $(this);
                const url = $el.attr(attr);
                $el.attr(attr, require('url').resolve(relativeTo, url));
              });
            });
            return $.html();
          }
        }
      ],
      discoverers: [
        {
          type: 'text/html',
          function: function(urls, url, body) {
            const $ = cheerio.load(body);
            _.each(config.urlAttrs, function(attr) {
              $('[' + attr + ']').each(function() {
                const $el = $(this);
                const newUrl = $el.attr(attr);
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
            const re = /url\(\'(.*?)\'\)/g;
            let matches;
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
            const $ = cheerio.load(body);
            _.each(config.urlAttrs, fix);
            // console.log($.html());
            // process.exit(1);
            return $.html();
            function fix(attr) {
              $('[' + attr + ']').each(function() {
                const $el = $(this);
                const newUrl = $el.attr(attr);
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
      ],
      remap: remap
    };

    merge(config, _.clone(userConfig.defaults));
    merge(config, _.omit(argv, '_'));
    merge(config, site);

    let allowed = _.map(config.aliases || [], function(alias) {
      return alias.toLowerCase();
    });

    allowed = _.filter(allowed, function() {
      return allowed.length;
    });

    const url = config.url;
    if (!url) {
      throw new Error('url is required, see the documentation');
    }

    const parsed = require('url').parse(url);
    allowed.push(parsed.hostname.toLowerCase());

    if (config.aliasWww) {
      if (parsed.hostname.match(/^www\./)) {
        allowed.push(parsed.hostname.replace(/^www\./, ''));
      } else {
        allowed.push('www.' + parsed.hostname);
      }
    }

    const defaultHostname = parsed.hostname;

    if (!config.folder) {
      config.folder = defaultHostname;
    }

    if (userConfig.init) {
      userConfig.init(config);
    }
    
    return Promise.try(function() {
      return mirror(url);
    });

    function mirror(url) {
      // console.log('mirroring ' + url);
      url = url.toString();
      const parsed = require('url').parse(url);
      let path;
      let folderPath;
      let urls = [];
      let type;
      let body;
      
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
        let extension = config.contentTypeToExtension[type];
        if (!extension) {
          const matches = parsed.pathname.match(/\.([^\.\/]+)$/);
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
          const parsed = require('url').parse(url);
          delete parsed.host;
          parsed.hostname = hostname;
          urlMap[require('url').format(parsed)] = path;
        });
        // The filename should not contain %20, it
        // should contain an actual space. Later, the webserver
        // serving the mirror will interpret %20 and read that file
        const filename = decodeURIComponent(filename);
        // ... But don't allow this to be used as a hack to
        // access inappropriate folders
        filename = filename.replace(/\.\./g, '');
        path = config.folder + filename;
        folderPath = path.replace(/[^\/]+$/, '');
        return fs.mkdirp(folderPath).then(function() {
          return writeFile(path, response.body);
        }).then(function() {
          let some = false;
          return Promise.mapSeries(config.preprocessors, function(preprocessor) {
            if (type !== preprocessor.type) {
              return;
            }
            some = true;
            return Promise.try(function() {
              return preprocessor.function(url, body.toString('utf8'), config)
            }).then(function(_body) {
              body = _body;
            });
          }).then(function() {
            if (some) {
              return fs.writeFile(path, body);
            }
          });
        }).then(function() {
          return Promise.mapSeries(config.discoverers, function(discoverer) {
            if (type !== discoverer.type) {
              return;
            }
            return Promise.try(function() {
              return discoverer.function(urls, url, body.toString('utf8'), config);
            });
          });
        }).then(function() {
          return Promise.mapSeries(config.filters, function(filter) {
            return Promise.try(function() {
              return filter(urls, config);
            }).then(function(_urls) {
              urls = _urls;
            });
          });
        }).then(function() {
          urls = _.map(urls, function(newUrl) {
            return require('url').resolve(url, newUrl);
          });
          urls = _.filter(urls, allowedUrl);
          return Promise.mapSeries(urls, mirror);
        }).then(function() {
          let some = false;
          return Promise.mapSeries(config.rewriters, function(rewriter) {
            if (type !== rewriter.type) {
              return;
            }
            some = true;
            return Promise.try(function() {
              return rewriter.function(url, body.toString('utf8'), config)
            }).then(function(_body) {
              body = _body;
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
      const hashAt = newUrl.indexOf('#');
      let hash = '';
      let path;
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
      const parsed = require('url').parse(newUrl);
      if (!_.includes(allowed, parsed.hostname)) {
        return false;
      }
      return true;
    }

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
}
