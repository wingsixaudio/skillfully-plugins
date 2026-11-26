# Libraries that publish no license text

A package the store hands out must carry the license notice of everything bundled inside it. The store's build
works out what is really bundled and adds any notice the module's own build left out.

A few libraries declare a license and publish no license text at all, so there is no notice to pass on. They
are listed in `without-text.json`, each with where that was checked. A bundled library that has no license
text and is not on this list fails the checks, until someone looks and adds it here.

Add an entry only after reading what that exact version publishes, and say where you looked.
