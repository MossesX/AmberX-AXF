# AmberX notes: duplicate clean-up, DRY RUN (Nov 1 2026)

Nothing was deleted. Source: hub `amberx-axf` data folder `amberx-notes/items` (206 items). Rule: items with the same
kind, list, title and text are duplicates; the **oldest is kept**, the rest would be removed. Most are AmberX's own
mis-heard "Note saved to Inbox." saved by the loop (see `amberx-listeners.md`). Deleting needs Brett's go (hub delete).

| Kept (oldest) | Title | Copies | Would remove |
|---|---|---|---|
| `n-mvu8sohs27u` 2026-10-30T00:37 | save ten bucks | 52 | 51 |
| `n-mvu0fzpp7at` 2026-10-29T20:43 | safety | 26 | 25 |
| `t-mvxfc7wskjq` 2026-11-01T06:03 | Save ten bucks | 11 | 10 |
| `n-mvu0fvd36qm` 2026-10-29T20:43 | Safety | 7 | 6 |
| `n-mvw96eydo6p` 2026-10-31T10:23 | huh | 6 | 5 |
| `n-mvxfa5v3azg` 2026-11-01T06:01 | No safety | 6 | 5 |
| `n-mvxff90y14vl` 2026-11-01T06:05 | No safety bucks | 6 | 5 |
| `n-mvu8t2m7862` 2026-10-30T00:37 | save | 5 | 4 |
| `n-mvxfaaoub8o` 2026-11-01T06:02 | ten bucks | 4 | 3 |
| `n-mvu0fqe55q6` 2026-10-29T20:43 | safety inbox | 3 | 2 |
| `n-mvu0c51n0j3` 2026-10-29T20:40 | hey amber | 2 | 1 |
| `n-mvw8id9j2op` 2026-10-31T10:04 | Safety and bugs | 2 | 1 |
| `n-mvxf9boy48u` 2026-11-01T06:01 | fifteen bucks | 2 | 1 |
| `n-mvxfbxcdinf` 2026-11-01T06:03 | no | 2 | 1 |
| `n-mvxfcutop3i` 2026-11-01T06:04 | no safety ten bucks | 2 | 1 |
| `n-mvxfg3ad1ahb` 2026-11-01T06:06 | no ten bucks | 2 | 1 |

**Would remove 122 of 206 items, keep 84.**

Ids to remove:

```
n-mvu8st6z36w
n-mvu8swu0562
n-mvu8t0rb623
n-mvu8t0rw7fh
n-mvw8izo9aln
n-mvw8j1rqbwu
n-mvw96f2npt5
n-mvxf9s17685
n-mvxf9sej7z7
n-mvxf9wyq8xy
n-mvxfaxaedzy
n-mvxfboxlgfi
n-mvxfbtebhd8
n-mvxfch81mim
n-mvxfclb3nxt
n-mvxfd4akrlv
n-mvxfd95rsii
n-mvxfe9s9x2s
n-mvxfeerby3
n-mvxff2xv13kr
n-mvxffdzr155z
n-mvxffjxe16fj
n-mvxffu2018q3
n-mvxffyji192i
n-mvxfgg0r1dlu
n-mvxfghv51egr
n-mvxfgjpw1fko
n-mvxfglki1gev
n-mvxfgnf61hr1
n-mvxfgp9t1ijz
n-mvxfgr4h1j9h
n-mvxfgsz91kx1
n-mvxfgutt1li1
n-mvxfgwoi1mqe
n-mvxfis8323hi
n-mvxfj29x25sr
n-mvxfjghi282d
n-mvxfjqcz2ar
n-mvxfkecq2gg4
n-mvxfkpro2i6d
n-mvxfkuz72joo
n-mvxfl9he2m39
n-mvxfle9o2nch
n-mvxflse82qjg
n-mvxfm13g2sv7
n-mvxfm5oi2tpr
n-mvxfmahx2uza
n-mvxfmfe22vzb
n-mvxfmjf42waa
n-mvxfmo5q2xx
n-mvxfojmz2z30
n-mvu0gesuasf
n-mvu8suze4qi
n-mvw8mqj9mfg
n-mvxfc2lojis
n-mvxfd03uqas
n-mvxfdticutr
n-mvxfe4t4wzs
n-mvxffows17qr
n-mvxfge351c46
n-mvxfij7y21vl
n-mvxfiog92262
n-mvxfjc7x27z4
n-mvxfjmbv298r
n-mvxfljyd2opy
n-mvxfmsr02y3k
n-mvxfonqk305m
n-mvxfoxzj32h
n-mvxfp7cm3480
n-mvxfphoz3621
n-mvxfq7os39hu
n-mvxfqd863a3n
n-mvxfwza93cev
n-mvxfx84z3etn
n-mvxfxgia3fmk
n-mvxfxhoq3gc2
t-mvxfeovj109v
t-mvxfhtbc1soc
t-mvxfhtbd1tb6
t-mvxfhyww1ui6
t-mvxfhyww1vzv
t-mvxfi4xu1wf8
t-mvxfi4xu1xbw
t-mvxfi9f91y59
t-mvxfi9f91z68
t-mvxfk41e2dyf
n-mvw8ixu29im
n-mvxfa15j9od
n-mvxfafcbcyi
n-mvxfho3a1rb9
n-mvxfixof2486
n-mvxfpcdo35cb
n-mvw96fbvsni
n-mvw96g16wn9
n-mvw96g6910v1
n-mvw96gc5118r
n-mvw96gjk14mu
n-mvxfjyqk2cqo
n-mvxfl04c2kjy
n-mvxfosw731lz
n-mvxfp35j33e2
n-mvxfx3333doh
n-mvxfh2rj1n6i
n-mvxfh95j1o4i
n-mvxfj78926sh
n-mvxfkjd92h9e
n-mvxflwwn2rn5
n-mvu8t4h495h
n-mvu8t8lfamj
n-mvu8t8zbbof
n-mvu8tdendcy
n-mvxfhdz41pwn
n-mvxfhisz1q1b
n-mvxfl4ut2lwx
n-mvu8tf79e8l
n-mvw8mk5nlw5
n-mvu0d8em2mu
n-mvw8iiti398
n-mvxfey6112el
n-mvxfq2y4376d
n-mvxfej0nz1t
n-mvxfg7uz1bnj
```
