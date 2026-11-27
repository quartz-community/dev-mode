---
status: reproduced # quartz-community/utils#29 (unmerged); set to fixed once released and in Quartz
issue: "TalionOak/Carvalho (user report), quartz-community/utils#29"
plugin: utils
---

# Inline tag links leave a site served under a base path

obsidian-flavored-markdown builds an inline `#tag` link as `pathToRoot(slug) + "/tags/<tag>"`
(`../../tags/foo` from `folder/deeper/note`). Core's link step passes it to `transformLink`
from `@quartz-community/utils`, which under `shortest` (the default) and `absolute` read it as a
path from the vault root, dropped only its first `.` and put `pathToRoot` in front again:
`../../.././../tags/foo`. At a domain root the browser clamps the extra `..`; under `/sub` the
link goes to `/tags/foo`, a 404.

Expected: the tag link goes to `/sub/tags/foo`, from any folder depth.
