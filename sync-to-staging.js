var exec = require('child_process').execSync;
var fs = require('fs');
var sites = fs.readdirSync('sites');

sites.forEach(function(site) {
  var path = '/var/www/' + site + '.punkave.net/symfony/web';
  console.log(site);
  run('ssh root@staging.punkave.net mkdir -p ' + path);
  run('ssh root@staging.punkave.net chown -R staging /var/www/' + site + '.punkave.net');
  run('rsync -a sites/' + site + '/ staging@staging.punkave.net:' + path);
  console.log('ssh root@staging.punkave.net mechanic add ' + site + ' --host=' + site + '.punkave.net --static=false --backends=localhost:9898');
});

function run(cmd) {
  console.log(cmd);
  exec(cmd);
}
