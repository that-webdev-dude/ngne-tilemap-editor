# Third-party notices

Parts of this repository are derived from third-party source code. Each part and its licence
is listed below. Runtime dependencies installed through npm carry their own licences in
`node_modules`; the build writes this file, the program's licence, the licence of every npm
package it bundles and the licence of rolldown, the bundler, to `licences.txt`, which the app
shows in a dialog (View → Open Source Licences…).

NGNE Tilemap Editor is not affiliated with or endorsed by Tiled or Thorbjørn Lindeijer, nor by
Aseprite or Igara Studio S.A. "Tiled" and "Aseprite" are used only to name the programs whose
file formats, behaviour or code this editor follows.

Tiled's editor (`src/tiled` of <https://github.com/mapeditor/tiled>, GPL-2.0-or-later) is not
copied here: where this editor follows its behaviour, the behaviour was reimplemented from
using Tiled, its manual and, where the code comments say "checked at v1.12.2", reading its
source to confirm a detail. Aseprite's application code is not used.

Other product names used here are trademarks of their respective owners.

## libtiled (BSD-2-Clause)

Source: `src/libtiled/wangset.h`, `src/libtiled/wangset.cpp` and `src/libtiled/tilelayer.cpp`
of Tiled (<https://www.mapeditor.org>, <https://github.com/mapeditor/tiled>), tag `v1.12.2`.
These files of libtiled are released under the BSD 2-clause licence.

Used in:

- `src/core/terrain/wangId.ts`: the layout of terrain IDs (eight indexes, corners and edges,
  "no wish" byte).
- `src/core/terrain/analysis.ts`: the terrain-set analysis (candidate list, colour distances,
  completeness).
- `src/core/terrain/terrainCommands.ts`: the default terrain colours (`defaultWangColors`).
- `src/core/cells/orientation.ts` and `tests/unit/te-004-orientation.test.ts`: the rotation
  tables of the eight cell orientations.

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

Source: `plotEllipse` and `plotEllipseRect` of Alois Zingl's
<https://github.com/zingl/Bresenham>, described in his "A Rasterizing Algorithm for Drawing
Curves" (2012).

Used in:

- `src/core/raster/ellipse.ts`: `plotEllipse`, the ellipse outline.
- `src/core/fill/region.ts` (`ellipseRegion`) and `tests/unit/te-019-fill.test.ts`:
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

Used in:

- `tests/fixtures/tmj/build.ts` and `tests/unit/support/terrainFixtures.ts`: the JSON text of
  the test fixtures, written as Tiled writes it.

```text
Copyright (c) 2010 Girish Ramakrishnan <girish@forwardbias.in>

Use, modification and distribution is allowed without limitation,
warranty, liability or support of any kind.
```
