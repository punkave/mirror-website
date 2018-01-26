Usage:

Create `config.js`. Make sure you export a `sites` property, which should be an array in which every entry has a `url` property and, optionally, `aliases` (an array of hostnames considered equivalent to the main one). TODO: document more.

Then run:

`node app`

This creates a subdirectory in the current directory named after the domain name in your URL.


