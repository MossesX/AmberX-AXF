# Web libraries

Libraries for the web port (React/TypeScript), one folder each, generated from `framework/library-templates` by
`axf new-library … --ports web` or `axf port-library <slug> --to web`. Each exports `library: AxfWebLibrary`
(`framework/react/library.ts`); apps merge them with `installLibraries(runtime, [...])`.
Type-check them all: `cd framework && npm install && npm run check:libs` (what `axf compile-library` runs).
