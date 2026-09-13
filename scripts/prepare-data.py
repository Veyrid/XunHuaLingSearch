"""Restore disposable build inputs from official, pinned GitHub archives.

Default: use local archives only. --download permits downloading missing archives.
No website crawling and no execution of code from the downloaded repositories.
"""
import argparse
import csv
import hashlib
import io
import json
import re
import sys
import tarfile
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / '.cache'


def infer_genre(title, content, cipai):
    head = re.split(r'[\s·・：:（(]', title, maxsplit=1)[0]
    if head not in cipai:
        return '诗'
    # The supplied tune list also contains generic two-character poem titles
    # such as 九日 / 西湖 / 子夜. Don't treat regular verse as lyrics for those.
    clauses = [re.sub(r'[\s、]', '', s) for s in re.split(r'[，。！？；,;]', content) if s.strip()]
    if len(head) <= 2 and clauses and len({len(s) for s in clauses}) == 1 and len(clauses[0]) in (4, 5, 7):
        return '诗'
    return '词'


def csv_paragraphs(content):
    # An ASCII ? may mean a missing character and must remain inside its line.
    return [p for p in re.findall(r'[^。]*。(?:[”」』])?|[^。]+$', content) if p.strip()]


def covered_aggregates(rows):
    """Exclude a combined work only when individual numbered poems cover it exactly."""
    groups = {}
    for row in rows:
        match = re.fullmatch(r'(.+?)\s+其[一二三四五六七八九十百零〇\d]+(?:\s.*)?', row['题目'])
        if match:
            groups.setdefault((row['作者'], match[1]), set()).add(row['内容'])
    omitted = set()
    for i, row in enumerate(rows):
        candidates = groups.get((row['作者'], row['题目']))
        if not candidates or len(candidates) < 2:
            continue
        # Reachability avoids choosing the wrong prefix for repeated poems.
        content = row['内容']; reached = {0}
        for at in range(len(content)):
            if at in reached:
                for part in candidates:
                    if part and content.startswith(part, at):
                        reached.add(at + len(part))
        if len(content) in reached:
            omitted.add(i)
    return omitted


def apply_correction(row, corrections):
    key = (row['作者'].strip(), row['题目'].strip(), hashlib.sha256(row['内容'].strip().encode()).hexdigest())
    correction = corrections.get(key)
    if not correction:
        return None
    content = row['内容'].strip()
    if 'paragraphs' in correction:
        paragraphs = correction['paragraphs']
    elif 'singleGroups' in correction:
        clauses = [s for s in content.split('。') if s]
        if len(clauses) != 357 or any(len(s) != 5 for s in clauses):
            raise ValueError('Reviewed five-character line layout changed')
        paragraphs = []; at = 0
        for group in range(184):
            n = 1 if str(group) in correction['singleGroups'] else 2
            if n == 1 and clauses[at] != correction['singleGroups'][str(group)]:
                raise ValueError('Reviewed singleton moved')
            paragraphs.append('，'.join(clauses[at:at+n]) + '。'); at += n
        if at != len(clauses):
            raise ValueError('Incomplete reviewed layout')
    else:
        paragraphs = csv_paragraphs(content)
    letters = lambda s: re.sub(r'[，。！？；、\s]', '', s)
    if letters(''.join(paragraphs)) != letters(content):
        raise ValueError('Reading correction must not alter poem characters')
    return {**correction, 'paragraphs': paragraphs}


def original_member(name):
    return name == 'LICENSE' or name in {
        '蒙学/tangshisanbaishou.json', '蒙学/qianjiashi.json',
        '水墨唐诗/shuimotangshi.json', '诗经/shijing.json',
        '曹操诗集/caocao.json', '纳兰性德/纳兰性德诗集.json',
        '五代诗词/nantang/poetrys.json',
    } or bool(re.fullmatch(r'(全唐诗/poet\.(tang|song)\.\d+|宋词/ci\.song\.\d+|五代诗词/huajianji/huajianji-[1-9x]-juan)\.json', name))


def write_member(base, name, content):
    target = (base / name).resolve()
    target.relative_to(base.resolve())  # Never trust archive paths.
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(content)


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--download', action='store_true')
    args = parser.parse_args()
    lock = json.loads((ROOT / 'data-sources.lock.json').read_text(encoding='utf-8'))
    correction_list = json.loads((ROOT / 'sources/reading-corrections.json').read_text(encoding='utf-8'))
    corrections = {(c['author'], c['title'], c['contentSha256']): c for c in correction_list}
    CACHE.mkdir(exist_ok=True)
    # A failed rerun must never leave an old success marker for partial inputs.
    prepared_file = CACHE / 'prepared-data.json'
    prepared_file.unlink(missing_ok=True)
    stats = {'sources': [], 'supplementRows': 0, 'byDynasty': {}, 'missingGlyphRows': 0, 'lyricRows': 0, 'coveredAggregates': 0, 'reviewedCorrections': 0}
    for source in lock['sources']:
        archive = CACHE / source['archiveFile']
        if not archive.exists():
            if not args.download:
                raise SystemExit(f'Missing {archive.name}; run python scripts/prepare-data.py --download first.')
            print(f"Downloading official archive: {source['name']}", flush=True)
            partial = archive.with_suffix(archive.suffix + '.partial')
            urllib.request.urlretrieve(source['archiveUrl'], partial)
            partial.replace(archive)
        with tarfile.open(archive, 'r:gz') as bundle:
            if bundle.pax_headers.get('comment') != source['commit']:
                raise SystemExit(f"Archive version mismatch: {source['name']}")
            members = {m.name.split('/', 1)[1]: m for m in bundle.getmembers() if m.isfile() and '/' in m.name}
            if source['id'] == 'chinese-poetry':
                for name, member in members.items():
                    if original_member(name):
                        write_member(CACHE / 'chinese-poetry-master', name, bundle.extractfile(member).read())
            else:
                destination = CACHE / 'werneror-poetry'
                destination.mkdir(exist_ok=True)
                write_member(destination, 'LICENSE', bundle.extractfile(members['LICENSE']).read())
                raw_cipai = bundle.extractfile(members['cipai_2.txt']).read().decode('utf-8-sig')
                cipai = set(raw_cipai.split())
                selected = set(source['includedDynasties'])
                records_partial = destination / 'records.jsonl.partial'
                with records_partial.open('w', encoding='utf-8', newline='\n') as output:
                    for name, member in sorted(members.items()):
                        if not name.endswith('.csv') or re.sub(r'_\d+$', '', Path(name).stem) not in selected:
                            continue
                        rows = csv.DictReader(io.TextIOWrapper(bundle.extractfile(member), encoding='utf-8-sig', newline=''))
                        if rows.fieldnames != ['题目', '朝代', '作者', '内容']:
                            raise ValueError(f'Unexpected CSV columns: {name}: {rows.fieldnames}')
                        columns = rows.fieldnames
                        rows = list(rows)
                        if any(None in r or any(r.get(k) is None for k in columns) for r in rows):
                            raise ValueError(f'Malformed CSV: {name}')
                        omitted = covered_aggregates(rows)
                        stats['coveredAggregates'] += len(omitted)
                        for row_index, row in enumerate(rows):
                            if row_index in omitted:
                                continue
                            if None in row or any(row.get(k) is None for k in columns):
                                raise ValueError(f'Malformed CSV row: {name}')
                            dynasty = row['朝代'].strip()
                            if dynasty not in selected:
                                raise ValueError(f'Unexpected dynasty {dynasty} in {name}')
                            title, content = row['题目'].strip(), row['内容'].strip()
                            # Match a whole title prefix, never a substring in a poem title.
                            genre = infer_genre(title, content, cipai)
                            # CSV has no paragraph field: infer rows at existing full stops.
                            paragraphs = csv_paragraphs(content)
                            record = {'title': title, 'author': row['作者'].strip(), 'dynasty': dynasty,
                                      'paragraphs': paragraphs, 'genre': genre, 'asciiQuestionAsGap': True}
                            reviewed = apply_correction(row, corrections)
                            if reviewed:
                                record['paragraphs'] = reviewed['paragraphs']
                                record['dynasty'] = dynasty = reviewed.get('dynasty', dynasty)
                                record['editorialNote'] = reviewed['note']
                                record['referenceUrl'] = reviewed['referenceUrl']
                                stats['reviewedCorrections'] += 1
                            output.write(json.dumps(record, ensure_ascii=False, separators=(',', ':')) + '\n')
                            stats['supplementRows'] += 1
                            stats['byDynasty'][dynasty] = stats['byDynasty'].get(dynasty, 0) + 1
                            stats['missingGlyphRows'] += '?' in content
                            stats['lyricRows'] += genre == '词'
                records_partial.replace(destination / 'records.jsonl')
            stats['sources'].append({**source, 'archiveSha256': hashlib.file_digest(archive.open('rb'), 'sha256').hexdigest()})
    prepared_file.write_text(json.dumps(stats, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({k: v for k, v in stats.items() if k != 'sources'}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
