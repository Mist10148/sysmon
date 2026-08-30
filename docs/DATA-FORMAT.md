# The SysMon data format

**Version** 1 · **Status** Implemented

This is the normative description of the `.txt` files SysMon reads and writes. It
is one format used in three places — the built-in seed, what Export produces, and
what is kept in browser storage — because one format means one parser to get right.

Sample files live in [`../data/`](../data/).

---

## 1. Why tab-separated text

The fields that most need to survive a round trip are the two an operator types by
hand: *Issues encountered* and *Remarks*. Those are prose, written while on the
phone to an LHIO, and they are full of commas, apostrophes and quotation marks.

Quoting is the part of CSV that everyone implements slightly differently, and the
failure is silent: a row shifts by one column and nobody notices until a month
later. A tab is a character nobody types into a form, so escaping it is enough, and
the escaping rule is three characters long.

JSON was the other candidate and was rejected for one reason: a person has to be
able to open one of these in Notepad, find the line for BACOLOD, change it, and
save. One record per line is what makes that true, and it is also what makes a
`git diff` of exported data readable.

## 2. File structure

```
# SysMon - locations (site x system)
# @version 1
# @table locations
# @exported 2026-08-28T14:02:11
# An empty field is a dash. Booleans are yes or no. Fields are tab-separated.
# One row per site per system. system_type_id must match a row in the system types file.
@columns	id	sort_order	system_type_id	name	ip	lat	lng	region	active
1	1	1	ANTIQUE	172.24.142.144	10.7402	121.9391	Region VI	yes
2	2	1	CAPIZ	172.24.143.168	11.5853	122.7511	Region VI	yes
```

**Comment lines** begin with `#` and are ignored, except that two carry meaning:

- `@version` — the format version. A file declaring a version higher than the
  reader understands is refused rather than misread.
- `@table` — which table the file holds. This is how Import identifies a file, so
  filenames do not matter and can be changed freely.

**The `@columns` line** names the columns present, in the order the fields appear.
It is required. Records are read **by column name, not by position**, so a
hand-reordered file still loads, and a column the reader does not recognise is
skipped rather than fatal.

**Record lines** are the remaining lines: fields separated by a single tab
character, in the order given by `@columns`.

**Line endings** are CRLF on write, because the most likely thing to open one of
these files is Notepad on the PC that runs the office. Both CRLF and LF are
accepted on read.

**Encoding** is UTF-8 on write and on read.

## 3. Field rules

| Rule | |
| --- | --- |
| Empty | A single dash, `-`. Never an empty string, so a row cannot be silently misaligned by an editor that trims trailing whitespace. |
| Booleans | `yes` or `no`. On read, `true` and `1` are also accepted. |
| Integers | Plain digits. A dash means "not set", which for a nullable column such as `http_port` is different from zero. |
| Numbers | A decimal point, up to six places. Coordinates need six; latency needs none. |
| Text | Escaped as below. |

**Escapes**, valid inside any text field:

| Sequence | Means |
| --- | --- |
| `\t` | A tab |
| `\n` | A newline |
| `\\` | A backslash |

Nothing else is escaped. An unrecognised escape keeps its second character, so a
hand-edited file with a stray backslash loses the backslash rather than the line.

**On reading**, a missing column takes the default from the schema, so a file
written by an earlier version still loads. New columns are therefore always added
to the end.

## 4. The tables

### `sysmon-system-types.txt`

A system is a service that every site runs a copy of. It owns the question asked of
its sites.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | int | Unique. `locations.system_type_id` points at it. |
| `sort_order` | int | Manual order, 1-based. Edit this to reorder. |
| `slug` | text | Machine name, unique, derived from the name on creation. |
| `name` | text | Up to 60 characters. |
| `description` | text | Up to 300 characters. |
| `color` | text | One of `blue orange teal amber rose green violet slate`. Identity, never health. |
| `icon` | text | A sprite name — `monitor ticket server globe activity radio heart-pulse shield database map-pin`. |
| `check_method` | text | `ping` or `http`. |
| `http_scheme` | text | `http` or `https`. Ignored when the method is `ping`. |
| `http_port` | int | Dash for the scheme default. |
| `http_path` | text | Defaults to `/`. |
| `http_expect_status` | int | 100–599, usually 200. |
| `active` | bool | `no` means its sites are not checked. |

### `sysmon-locations.txt`

One row per site per system. The same office running two systems is two rows.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | int | Unique. `checks.location_id` points at it. |
| `sort_order` | int | Manual order, 1-based. |
| `system_type_id` | int | Must match a system. An unmatched value shows as *Unassigned* rather than failing. |
| `name` | text | Up to 80 characters. |
| `ip` | text | An address or hostname. |
| `lat` | num | −90 to 90. |
| `lng` | num | −180 to 180. |
| `region` | text | Up to 80 characters. |
| `active` | bool | `no` means it is left out of sweeps; its history is kept. |

Coordinates are approximate municipal centres, not surveyed office locations. They
are close enough to put a pin in the right town and no closer, which is all the map
is for.

### `sysmon-checks.txt`

One row per check. This is the biggest file by a wide margin.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | int | Unique. |
| `run_id` | text | Groups the checks written by one sweep, e.g. `r-20260828-080502`. |
| `location_id` | int | An unmatched value shows as *Removed site*. |
| `checked_at` | text | Local ISO-8601, second precision — see §5. |
| `check_method` | text | `ping` or `http`, as it was at the time. |
| `functional` | bool | Whether the check passed. |
| `packets_sent` | int | 1 for an HTTP check. |
| `packets_lost` | int | |
| `loss_pct` | num | |
| `avg_latency_ms` | num | Dash when the check failed. |
| `http_status` | int | Dash for a ping. |
| `status` | text | `Functional`, `Restored` or `Down` — see §6. |
| `status_overridden` | bool | `yes` if a person changed the status by hand. |
| `issues` | text | Operator text, up to 2000 characters. |
| `remarks` | text | Operator text, up to 2000 characters. |
| `source` | text | `live` if a probe agent measured this check, `sim` if it was simulated. |
| `raw_output` | text | The full transcript. Last on purpose, being the long one. |

### `sysmon-activity.txt`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | int | Unique. |
| `at` | text | Local ISO-8601. |
| `kind` | text | `sweep status location system_type settings check` — what the Kind filter groups by. |
| `action` | text | e.g. `status.down`. Chooses the icon. |
| `severity` | text | `info success warning critical`. |
| `subject` | text | A sentence a person would say: "BACOLOD went down". |
| `detail` | text | The machine half, shown underneath. |
| `location_id` | int | Dash if not about one site. |
| `system_type_id` | int | Dash if not about one system. |
| `run_id` | text | Set for entries produced by a sweep. |

### `sysmon-settings.txt`

The exception: `key = value` lines rather than columns, because this is the file
most likely to be edited by hand.

| Key | Default | Meaning |
| --- | --- | --- |
| `auto_sweep_enabled` | `0` | Whether the in-tab timer runs. |
| `auto_sweep_minutes` | `5` | 1–1440. |
| `sweep_packets` | `4` | 1–20. |
| `sweep_timeout_ms` | `1000` | 100–20000. |
| `notifications_enabled` | `0` | Desktop notifications. Also requires browser permission. |
| `theme` | `system` | `light`, `dark` or `system`. |
| `seed_salt` | `sysmon-wv-2026` | Seeds every simulated result. Change it for a different month. |
| `backfill_days` | `42` | How much history a fresh install generates, in days ending today. `0` for none. |

Values out of range are clamped to the nearest bound on read rather than rejected.
Unknown keys are preserved and written back, so a newer file round-trips through an
older build without losing settings.

## 5. Timestamps

Local ISO-8601 at second precision: `2026-08-28T14:02:11`. No timezone suffix, no
UTC.

This is deliberate. The monitoring form records local dates, and the History and
Analytics filters compare on the leading `YYYY-MM-DD`, which only works when the
stored string is already local. Timestamps are parsed field by field rather than by
`new Date(string)`, because that reads a bare date as UTC and would move a check
recorded at half past midnight onto the previous day.

The consequence to be aware of: moving data between machines in different
timezones does not adjust the times, because the times are records of when someone
in that office looked.

## 6. Status

Three values, and the middle one is the point:

| Value | When |
| --- | --- |
| `Down` | The check failed. |
| `Restored` | The check passed and the one before it failed. |
| `Functional` | The check passed and so did the one before it. |

`Restored` exists so a recovery is findable in a list of a thousand rows. Without
it, a site that fell over at 09:00 and came back at 09:30 leaves two `Functional`
rows either side of a `Down` one, and the moment it came back — the thing the
monthly report needs — has to be inferred.

`status_overridden` marks a row a person changed. The measurements are left alone,
so the row can be seen to disagree with itself, which is the honest outcome.

`source` says where the numbers came from: `live` when the probe agent measured the
check, `sim` when SysMon simulated it. It is recorded per row rather than per file
because one sweep can contain both — an agent that stops answering part-way through
leaves the rest of that sweep simulated. A file written before the column existed
reads as `sim`, which is what those rows were.

## 7. Import behaviour

- Files are matched to tables by `@table`, falling back to comparing their columns
  against each known table. Filenames are never used.
- It is a **replace**, not a merge: the tables present in the chosen files are
  replaced wholesale, and tables with no file are untouched. Merging rows that share
  ids has no correct answer, and quietly picking one is the kind of data loss nobody
  notices for a month.
- Nothing is written until every chosen file has parsed.
- Cross-file problems — a site pointing at a system that does not exist, a check
  belonging to a site that does not exist — are **warnings, not refusals**, and are
  shown before you confirm. Importing a locations file on its own legitimately
  points at systems already in the application.
- Ids are re-based after import, so the next row created cannot collide with a
  hand-edited file that starts at 40.
