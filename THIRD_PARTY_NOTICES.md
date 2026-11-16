# Third-party notices

Parts of this repository are derived from third-party source code. Each part and its licence
is listed below. Runtime dependencies installed through npm carry their own licences in
`node_modules`; the build writes this file, the program's licence, the licence of every npm
package it bundles and the licence of rolldown, the bundler, to `licences.txt`, which the app
shows in a dialog (View → Open Source Licences…). Code that a bundled package credits to another
project is listed here too (UZIP.js, react-merge-refs, smooth-ui).

NGNE Tilemap Editor is not affiliated with or endorsed by Tiled or Thorbjørn Lindeijer, nor by
Aseprite or Igara Studio S.A. "Tiled" and "Aseprite" are used only to name the programs whose
file formats, behaviour or code this editor follows.

Where this editor follows the behaviour of Tiled's editor application
(<https://github.com/mapeditor/tiled>, GPL-2.0-or-later), it does so from using Tiled and its
manual. Files whose comments, tests or specs named parts of that application's source, or said
that its source had been read to confirm a detail, are listed in the "Tiled source named or
read" section of `docs/PROVENANCE.md`. Aseprite's application code is not used.

Other product names used here are trademarks of their respective owners.

## libtiled (BSD-2-Clause)

Source: `src/libtiled/wangset.h`, `src/libtiled/wangset.cpp` and `src/libtiled/tilelayer.cpp`
of Tiled (<https://www.mapeditor.org>, <https://github.com/mapeditor/tiled>), tag `v1.12.2`.
These files of libtiled are released under the BSD 2-clause licence.

Version: Tiled tag `v1.12.2`.

Used in:

- `src/core/terrain/wangId.ts`: the layout of terrain IDs (eight indexes, corners and edges,
  one byte per index).
- `src/core/terrain/analysis.ts`: the terrain-set analysis (candidate list, colour distances,
  completeness).
- `src/core/terrain/terrainCommands.ts`: the default terrain colours (`defaultWangColors`).
- `src/core/cells/orientation.ts`, `tests/unit/te-004-orientation.test.ts`,
  `tests/e2e/te-018-transforms.spec.ts` and `docs/SPEC.md` (§2.3): the rotation tables of the
  eight cell orientations.

```text
Copyright 2008-2011, Thorbjørn Lindeijer <thorbjorn@lindeijer.nl>
Copyright 2009, Jeff Bland <jksb@member.fsf.org>
Copyright 2017, Benjamin Trotter <bdtrotte@ucsc.edu>

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

   1. Redistributions of source code must retain the above copyright notice,
      this list of conditions and the following disclaimer.

   2. Redistributions in binary form must reproduce the above copyright
      notice, this list of conditions and the following disclaimer in the
      documentation and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE CONTRIBUTORS ``AS IS'' AND ANY EXPRESS OR
IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO
EVENT SHALL THE CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS;
OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY,
WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR
OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF
ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

## Bresenham curve rasterizing algorithms (MIT)

Source: `plotOptimizedEllipse` and `plotEllipseRect` of `bresenham.c` in Alois Zingl's
<https://github.com/zingl/Bresenham>, described in his "A Rasterizing Algorithm for Drawing
Curves" (2012).

Version: commit `ce9002f5aa1d95bdb7d71a39ebdb0987df139db5`.

Used in:

- `src/core/raster/ellipse.ts`: `plotOptimizedEllipse`, the ellipse outline.
- `src/core/fill/region.ts` (`inscribedEllipseRegion`) and `tests/unit/te-019-fill.test.ts`:
  `plotEllipseRect`, the ellipse inscribed in a rectangle.

```text
MIT License

Copyright (c) 2020 zingl

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Aseprite Document Library (MIT)

Source: `src/doc/blend_funcs.cpp` of <https://github.com/aseprite/aseprite>. Aseprite's
application code is distributed under its End-User License Agreement; this file belongs to its
document library, which is released under the MIT licence (`src/doc/LICENSE.txt`).

Version: Aseprite v1.3.18.6 (commit `331e898ef405d919539c03fd1675691cfa16c3a3`).

Used in:

- `src/core/sprite/composite/blend.ts` (copied from the NGNE Sprite Editor,
  `docs/PROVENANCE.md`): the blend-mode formulas of `blend_funcs.cpp`.

```text
Copyright (c) 2018-present Igara Studio S.A.
Copyright (c) 2001-2018 David Capello

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

## pixman (MIT)

Source: the `MUL_UN8` and `DIV_UN8` macros of `pixman/pixman-combine32.h` in pixman
(<https://gitlab.freedesktop.org/pixman/pixman>).

Version: pixman 0.46.4.

Used in:

- `src/core/sprite/composite/blend.ts` (copied from the NGNE Sprite Editor,
  `docs/PROVENANCE.md`): the integer multiply and divide of 8-bit channels.

```text
Copyright 1987, 1988, 1989, 1998  The Open Group
Copyright 1987, 1988, 1989 Digital Equipment Corporation
Copyright 1999, 2004, 2008 Keith Packard
Copyright 2000 SuSE, Inc.
Copyright 2000 Keith Packard, member of The XFree86 Project, Inc.
Copyright 2004, 2005, 2007, 2008, 2009, 2010 Red Hat, Inc.
Copyright 2004 Nicholas Miell
Copyright 2005 Lars Knoll & Zack Rusin, Trolltech
Copyright 2005 Trolltech AS
Copyright 2007 Luca Barbato
Copyright 2008 Aaron Plattner, NVIDIA Corporation
Copyright 2008 Rodrigo Kumpera
Copyright 2008 André Tupinambá
Copyright 2008 Mozilla Corporation
Copyright 2008 Frederic Plourde
Copyright 2009, Oracle and/or its affiliates. All rights reserved.
Copyright 2009, 2010 Nokia Corporation

Permission is hereby granted, free of charge, to any person obtaining a
copy of this software and associated documentation files (the "Software"),
to deal in the Software without restriction, including without limitation
the rights to use, copy, modify, merge, publish, distribute, sublicense,
and/or sell copies of the Software, and to permit persons to whom the
Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice (including the next
paragraph) shall be included in all copies or substantial portions of the
Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.  IN NO EVENT SHALL
THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
```

## qjsonparser (permissive notice)

Source: `escape` and `JsonWriter::stringify` of `src/plugins/json/qjsonparser/json.cpp` in
Tiled's JSON plugin (<https://github.com/mapeditor/tiled>).

Version: the copy in Tiled tag `v1.12.2`.

Used in:

- `tests/fixtures/tmj/build.ts` and `tests/unit/support/terrainFixtures.ts`: the JSON text of
  the test fixtures, written as Tiled writes it.

```text
Copyright (c) 2010 Girish Ramakrishnan <girish@forwardbias.in>

Use, modification and distribution is allowed without limitation,
warranty, liability or support of any kind.
```

## UZIP.js (MIT)

Source: <https://github.com/photopea/UZIP.js>, which the npm package `fflate` credits: its
source says part of its code is similar to UZIP.js.

Version: the licence file at commit `95071093542682c2d4ed9b4e91855110ade73ce2`; the version
`fflate` followed is not stated.

Used in:

- `fflate` 0.8.3, bundled (its own licence is in `licences.txt`).

```text
MIT License

Copyright (c) 2018 Photopea

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## react-merge-refs (MIT)

Source: <https://github.com/gregberge/react-merge-refs>, on which the npm package
`use-callback-ref` says its `mergeRefs` is based.

Version: the licence file at commit `f81b2fa4110a660d82d6558ef99826120ce43805`; the version
`use-callback-ref` followed is not stated.

Used in:

- `use-callback-ref` 1.3.3, bundled (its own licence is in `licences.txt`).

```text
MIT License

Copyright (c) 2020 Greg Bergé

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## smooth-ui (MIT)

Source: <https://github.com/smooth-code/smooth-ui> (archived), on whose modal dialogs the npm
package `aria-hidden` says it is based.

Version: the licence file at commit `ad2e9a20c0dcf0da49fab09ade2c7bb8e3145b56`; the version
`aria-hidden` followed is not stated.

Used in:

- `aria-hidden` 1.2.6, bundled (its own licence is in `licences.txt`).

```text
Copyright 2018 Smooth Code

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```
