# Notices for what is bundled inside a module

A package the store hands out carries a notice for every library bundled inside it. The store's build works
out what is really bundled, and for each library the module's own build did not credit, it adds:

1. **The library's own license text**, when its package ships one: a license file, or a License section of its
   README that holds a copyright line or the words of a grant.
2. **A text supplied by hand** under `texts/`, when someone has the library's real license text and its
   package does not carry it.
3. **Otherwise, a credit by name.** Many libraries declare a license in their `package.json` and ship no text
   at all, so there is no notice of theirs to pass on. The package then says the library's name and version,
   the license it declares, its author and its source as its `package.json` gives them, and carries the
   standard text of that license from `standard/`.

`standard/` holds the standard text of each license the store hands out, copied unchanged from the SPDX
license list (https://github.com/spdx/license-list-data, the `text/` folder).

Two things still stop a module from being handed out:

- A bundled library that declares **no license at all**. Without one there is no permission to pass it on.
- A bundled library under a license that is **not one the store hands out** (see `tools/lib.ts`).

The report on a pull request says how many libraries were credited by name, so it is seen and not silent.
