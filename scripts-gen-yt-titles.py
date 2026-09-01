import re, subprocess, sys
from pathlib import Path

ENV = Path('/Users/duanganucha/Desktop/n8n-local/smart-story-nextjs/.env.local')
cfg = {}
for line in ENV.read_text(encoding='utf-8').splitlines():
    m = re.match(r'^(DB_[A-Z]+)=(.*)$', line.strip())
    if m: cfg[m.group(1)] = m.group(2)

def q(sql):
    r = subprocess.run(['mysql','-h',cfg.get('DB_HOST','127.0.0.1'),'-P',cfg.get('DB_PORT','3306'),
        '-u',cfg.get('DB_USER','root'),f"-p{cfg.get('DB_PASSWORD','')}",cfg.get('DB_NAME','smart_story_ai'),
        '--default-character-set=utf8mb4','-N','--raw','-e',sql],capture_output=True,text=True)
    if r.returncode: sys.exit('MySQL: '+r.stderr[:200])
    return [l.split('\t') for l in r.stdout.rstrip('\n').split('\n') if l]

# อีโมจิตามหมวด — ช่วยให้สะดุดตาในหน้าผลค้นหา
EMOJI = {
    'ผจญภัย':'🗺️','แฟนตาซี':'✨','มิตรภาพ':'🤝','สัตว์และธรรมชาติ':'🐾',
    'ความรู้และวิทยาศาสตร์':'🔬','คุณธรรมและข้อคิด':'💛',
}
# เดาอีโมจิจากคำในชื่อเรื่องเมื่อไม่มีหมวด
GUESS = [
    (r'กระต่าย','🐰'),(r'แมว|เหมียว|มิลกี้','🐱'),(r'ช้าง','🐘'),(r'หมี','🐻'),
    (r'นก|จิ๊บ|เจี๊ยบ','🐦'),(r'เต่า','🐢'),(r'ปลา|ทะเล|น้ำ','🐠'),(r'ดาว|จันทร์|อวกาศ','⭐'),
    (r'กบ','🐸'),(r'เป็ด|ก๊าบ','🦆'),(r'สิงโต','🦁'),(r'หมา|สุนัข|ตูบ','🐶'),
    (r'ผึ้ง','🐝'),(r'มด','🐜'),(r'กระรอก','🐿️'),(r'เพนกวิน','🐧'),(r'หมู','🐷'),
    (r'ลิง|จ๋อ','🐵'),(r'มังกร','🐉'),(r'หุ่นยนต์|โรโบ','🤖'),(r'ครู|โรงเรียน','🏫'),
    (r'หมอ|สัตวแพทย์','🩺'),(r'ต้นไม้|ป่า|สวน','🌳'),(r'ดอกไม้|ทานตะวัน','🌻'),
]

def pick_emoji(cat, title):
    # ตัวละครในชื่อเรื่องมาก่อนหมวด — 'มิลกี้' ควรได้ 🐱 ไม่ใช่ 🤝 ของหมวดมิตรภาพ
    for pat, e in GUESS:
        if re.search(pat, title): return e
    if cat and cat in EMOJI: return EMOJI[cat]
    return '📖'

def build(title, cat, age):
    """นิทานก่อนนอน <emoji> <ชื่อเรื่อง> | นิทานเด็ก <อายุ> ขวบ"""
    e = pick_emoji(cat, title)
    head = f'นิทานก่อนนอน {e} '
    tail = f' | นิทานเด็ก {age} ขวบ' if age else ' | นิทานเด็ก'
    room = 100 - len(head) - len(tail)
    t = title.strip()
    if len(t) > room:
        # ตัดที่ขอบคำไทยด้วยตัวตัดคำของ macOS
        sw = Path('/Users/duanganucha/Desktop/n8n-local/bearrytales-video/lib/thaiwrap.swift')
        cut = None
        if sw.exists():
            import tempfile
            with tempfile.NamedTemporaryFile('w',suffix='.txt',delete=False,encoding='utf-8') as f:
                f.write(t); tmp=f.name
            r = subprocess.run(['swift',str(sw),tmp],capture_output=True,text=True)
            Path(tmp).unlink(missing_ok=True)
            if r.returncode==0 and r.stdout.strip():
                acc=''
                for w in r.stdout.rstrip('\n').split('\x1f'):
                    if len(acc)+len(w) > room: break
                    acc += w
                cut = acc.strip()
        t = (cut or t[:room]).strip()
    return head + t + tail

rows = q("SELECT id, title, IFNULL(category,''), IFNULL(age_range,'') FROM stories WHERE title IS NOT NULL ORDER BY id")
out = []
for sid, title, cat, age in rows:
    yt = build(title, cat, age)
    assert len(yt) <= 100, f'{sid}: {len(yt)} ตัว'
    out.append((sid, yt))

def esc(s): return "'" + s.replace("\\","\\\\").replace("'","''") + "'"
cases = ' '.join(f'WHEN {sid} THEN {esc(yt)}' for sid, yt in out)
q(f"UPDATE stories SET youtube_title = CASE id {cases} END WHERE id IN ({','.join(str(s) for s,_ in out)})")

print(f'สร้างชื่อ YouTube แล้ว {len(out)} เรื่อง')
print(f'ความยาวเฉลี่ย {sum(len(y) for _,y in out)//len(out)} ตัว · ยาวสุด {max(len(y) for _,y in out)} ตัว')
print()
for sid, yt in out[:6]: print(f'  #{sid}  {yt}')
