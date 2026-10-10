# Pretext development snapshot

`chenglou-pretext-0.0.10-dev.1bbe835f9d.tgz` contains the unmodified library
sources and compiled package from [chenglou/pretext commit
1bbe835f9d672be3dd02364032d76581fdc0a434](https://github.com/chenglou/pretext/commit/1bbe835f9d672be3dd02364032d76581fdc0a434).

This is a local development version, not an official 0.0.10 release. Only the
package version, upstream commit metadata and removal of the prepack script
differ. The archive includes upstream's MIT license and source/declaration maps.

The snapshot keeps installs and Pages builds reproducible until the next npm
release. It was built with `tsc -p tsconfig.build.json` and packed with
`npm pack --ignore-scripts`. Replace this dependency with the official release
after checking rich-inline source offsets and hyphenation.
