#!/usr/bin/env python3
"""
เขียนแคปชันสำหรับโพสต์ภาพปกลง story_captions

ทำไมต้องเขียนล่วงหน้าเก็บใน DB:
  ถ้าให้ระบบประกอบข้อความตอนโพสต์ ทุกโพสต์จะหน้าตาเหมือนกันหมด
  Facebook มองว่าเป็นสแปมและลด reach — จึงต้องหลากหลายตั้งแต่ต้น
  และเก็บไว้ให้แก้ก่อนโพสต์จริงได้

วิธีกันซ้ำแบบ:
  - หมุน "รูปแบบเปิดเรื่อง" 8 แบบตาม id
  - ประโยคปิด/ชวนคุยสุ่มจากชุดที่ต่างกัน (seed ตาม id → ผลคงที่ รันซ้ำได้ผลเดิม)
  - แฮชแท็กหมุนชุด ไม่ซ้ำกันทุกโพสต์

  python3 scripts-gen-captions.py            # ทุกเรื่องที่ยังไม่มี
  python3 scripts-gen-captions.py --force    # เขียนทับของเดิม
  python3 scripts-gen-captions.py 2 3 5
"""
import argparse, random, re, subprocess, sys
from pathlib import Path

ENV = Path(__file__).resolve().parent / '.env.local'


def cfg():
    out = {}
    for line in ENV.read_text(encoding='utf-8').splitlines():
        m = re.match(r'^(DB_[A-Z]+)=(.*)$', line.strip())
        if m:
            out[m.group(1)] = m.group(2)
    return out


C = cfg()


def q(sql):
    r = subprocess.run(
        ['mysql', '-h', C.get('DB_HOST', '127.0.0.1'), '-P', C.get('DB_PORT', '3306'),
         '-u', C.get('DB_USER', 'root'), f"-p{C.get('DB_PASSWORD','')}",
         C.get('DB_NAME', 'smart_story_ai'),
         '--default-character-set=utf8mb4', '-N', '--raw', '-e', sql],
        capture_output=True, text=True)
    if r.returncode:
        sys.exit('MySQL: ' + r.stderr[:300])
    return [l.split('\t') for l in r.stdout.rstrip('\n').split('\n') if l]


# ── รูปแบบเปิดเรื่อง 8 แบบ ────────────────────────────────────────
# หมุนตาม id เพื่อให้โพสต์ที่ไล่กันไม่ซ้ำแบบ
HOOKS = [
    ('question',  lambda t, m: f'คืนนี้อ่านอะไรดี? 🌙'),
    ('moral',     lambda t, m: (f'“{m}” 💛' if m else 'นิทานเรื่องใหม่มาแล้ว 🌟')),
    ('invite',    lambda t, m: 'มีนิทานเรื่องใหม่มาเล่าให้ฟังค่ะ 🐻'),
    ('scene',     lambda t, m: f'วันนี้พาไปรู้จักกับ “{t}” ✨'),
    ('feeling',   lambda t, m: 'นิทานสั้น ๆ ก่อนนอน อ่านจบใน 5 นาที 🌛'),
    ('parent',    lambda t, m: 'สำหรับคุณพ่อคุณแม่ที่กำลังหานิทานอ่านให้ลูกฟัง 📖'),
    ('curious',   lambda t, m: f'“{t}” จะเป็นยังไงนะ? 🤔'),
    ('warm',      lambda t, m: 'อีกหนึ่งเรื่องอบอุ่นก่อนเข้านอน 🧸'),
]

# ประโยคชวนคุยท้ายโพสต์ — สุ่มตาม id
ENDINGS = [
    'ลูก ๆ ชอบตอนไหนมากที่สุด บอกกันได้เลยนะคะ 💬',
    'ถ้าชอบ กดติดตามเพจไว้ มีเรื่องใหม่ทุกสัปดาห์ค่ะ 🔔',
    'คืนนี้ลองอ่านให้ลูกฟังดูนะคะ 🌙',
    'เรื่องไหนที่อยากให้ทำต่อ คอมเมนต์บอกได้เลยค่ะ ✍️',
    'บันทึกโพสต์ไว้อ่านตอนก่อนนอนได้นะคะ 🔖',
    'แชร์เก็บไว้ให้ลูกฟังคืนนี้ได้เลยค่ะ 💫',
]

# ชุดแฮชแท็ก — หมุนไม่ให้ซ้ำ (3-5 ตัวพอ เยอะไปโดนตีเป็นสแปม)
TAGSETS = [
    ['#นิทานก่อนนอน', '#นิทานเด็ก', '#เลี้ยงลูกเชิงบวก'],
    ['#นิทานก่อนนอน', '#นิทานสอนใจ', '#อ่านให้ลูกฟัง'],
    ['#นิทานเด็ก', '#นิทานไทย', '#กิจกรรมเสริมพัฒนาการ'],
    ['#นิทานก่อนนอน', '#หนังสือเด็ก', '#คุณแม่มือใหม่'],
    ['#นิทานเด็ก', '#นิทานก่อนนอน', '#เวลาครอบครัว'],
]

AI_NOTE = '🤖 ภาพประกอบและเสียงบรรยายสร้างด้วย AI'


def age_line(age):
    return f'เหมาะกับเด็ก {age} ขวบ' if age else 'เหมาะกับเด็กเล็ก'


def build(sid, title, moral, age, story):
    rnd = random.Random(sid)          # seed ตาม id → รันซ้ำได้ผลเดิม
    style, fn = HOOKS[sid % len(HOOKS)]
    hook = fn(title, moral)

    # ประโยคเกริ่นจากเนื้อเรื่องจริง ตัดที่จบประโยค ไม่ค้างกลางคำ
    teaser = ''
    if story:
        first = re.split(r'\n+', story.strip())[0]
        s = re.split(r'(?<=[។\.\!\?])\s+', first)
        teaser = s[0].strip() if s else first.strip()
        if len(teaser) > 110:
            cut = teaser[:110]
            teaser = cut[:cut.rfind(' ')] if ' ' in cut else cut
            teaser += '…'

    parts = [hook, '']
    if teaser:
        parts += [teaser, '']
    parts.append(f'📖 {title}')
    parts.append(f'👶 {age_line(age)}')
    if moral and style != 'moral':
        parts.append(f'💡 ข้อคิด: {moral}')
    parts += ['', rnd.choice(ENDINGS), '', AI_NOTE, '']
    parts.append(' '.join(TAGSETS[sid % len(TAGSETS)]))
    return style, '\n'.join(parts)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('ids', nargs='*', type=int)
    ap.add_argument('--force', action='store_true', help='เขียนทับของเดิม')
    a = ap.parse_args()

    where = ''
    if a.ids:
        where = f" WHERE s.id IN ({','.join(str(i) for i in a.ids)})"

    # เนื้อเรื่องมีขึ้นบรรทัดใหม่ ทำให้ output แบบ tab แตก → ใช้ JSON แทน
    out = q(f"""
        SELECT JSON_ARRAYAGG(JSON_OBJECT(
                 'id', s.id, 'title', s.title,
                 'age', IFNULL(s.age_range,''),
                 'moral', IFNULL(JSON_UNQUOTE(JSON_EXTRACT(s.moral,'$[0]')),''),
                 'story', IFNULL(LEFT(s.story, 400), ''),
                 'cap', IFNULL(c.caption,'')))
        FROM stories s
        LEFT JOIN story_captions c ON c.story_id = s.id AND c.variant='photo'
        {where}
    """)
    import json as _json
    rows = _json.loads(out[0][0]) if out and out[0][0] not in (None, 'NULL') else []
    rows.sort(key=lambda x: x['id'])

    made, skipped = [], 0
    for r in rows:
        sid = int(r['id']); title = r['title']; age = r['age']
        moral = r['moral'] if r['moral'] not in ('', 'null', None) else ''
        story = r['story'] or ''; existing = r['cap'] or ''
        if existing and not a.force:
            skipped += 1
            continue
        style, cap = build(sid, title, moral, age, story)
        made.append((sid, style, cap))

    if not made:
        print(f'ไม่มีอะไรต้องเขียน (มีอยู่แล้ว {skipped} เรื่อง — ใช้ --force เพื่อเขียนทับ)')
        return

    def esc(x):
        return "'" + x.replace('\\', '\\\\').replace("'", "''") + "'"

    vals = ','.join(f'({sid},{esc("photo")},{esc(c)},{esc(st)})' for sid, st, c in made)
    q(f"""INSERT INTO story_captions (story_id, variant, caption, hook_style)
          VALUES {vals}
          ON DUPLICATE KEY UPDATE caption=VALUES(caption), hook_style=VALUES(hook_style)""")

    print(f'เขียนแคปชันแล้ว {len(made)} เรื่อง' + (f' · ข้าม {skipped} (มีอยู่แล้ว)' if skipped else ''))
    print(f'ความยาวเฉลี่ย {sum(len(c) for _,_,c in made)//len(made)} ตัวอักษร')
    print()
    print('── ตัวอย่าง 2 เรื่อง (คนละรูปแบบ) ──')
    for sid, st, c in made[:2]:
        print(f'\n[#{sid}  รูปแบบ: {st}]')
        print(c)


if __name__ == '__main__':
    main()
