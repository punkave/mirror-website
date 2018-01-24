// I find this handy in my own environment, your setup will
// probably be different but you could still benefit from
// the idea: output /etc/hosts entries to stdout while
// symlinking subdirs of sites/ to ~/Sites/*/web to make
// them live under Apache VirtualDocumentRoot

var fs = require('fs-extra');
var _ = require('lodash');

var sites = fs.readdirSync('sites');

_.each(sites, function(site) {
  fs.mkdirpSync('/Users/boutell/Sites/' + site);
  try {
    console.log('127.0.0.1 ' + site);
    fs.symlinkSync('/Users/boutell/src/mirror-website/sites/' + site, '/Users/boutell/Sites/' + site + '/web');
  } catch (e) {
    // probably already there
  }
});

