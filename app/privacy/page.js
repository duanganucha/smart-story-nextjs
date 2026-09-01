export const metadata = {
  title: 'นโยบายความเป็นส่วนตัว | หมีอ่าน BearryTales',
  description: 'นโยบายความเป็นส่วนตัวของแอปหมีอ่าน (BearryTales)',
};

// หน้านี้ต้องเข้าถึงได้แบบสาธารณะ — Meta และ Google บังคับให้มี Privacy Policy URL
// ที่เปิดได้โดยไม่ต้องล็อกอิน ตอนยื่น App Review
// (middleware.js ต้องปล่อยผ่าน ดูรายการ PUBLIC_PATHS)
export const dynamic = 'force-static';

const UPDATED = '2 กันยายน 2569';

export default function PrivacyPage() {
  return (
    <main style={{
      maxWidth: 760, margin: '0 auto', padding: '48px 24px 96px',
      fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
      lineHeight: 1.75, color: '#1f2937',
    }}>
      <h1 style={{ fontSize: 30, marginBottom: 4 }}>นโยบายความเป็นส่วนตัว</h1>
      <p style={{ color: '#6b7280', marginTop: 0 }}>
        แอปหมีอ่าน (BearryTales) · ปรับปรุงล่าสุด {UPDATED}
      </p>

      <Section title="เราเก็บข้อมูลอะไรบ้าง">
        <p>เมื่อคุณเข้าสู่ระบบด้วยบัญชี Google หรือ Apple เราเก็บเฉพาะ:</p>
        <ul>
          <li><b>ชื่อและอีเมล</b> — ใช้ระบุตัวตนและกู้คืนบัญชี</li>
          <li><b>รหัสผู้ใช้จากผู้ให้บริการ</b> — ใช้เชื่อมบัญชีเดิมเมื่อคุณกลับมาใช้งาน</li>
          <li><b>นิทานที่คุณสร้างและกดถูกใจ</b> — ใช้แสดงผลงานของคุณในแอป</li>
        </ul>
        <p>
          เรา<b>ไม่เก็บรหัสผ่าน</b> ของคุณ เพราะการเข้าสู่ระบบทำผ่าน Google และ Apple โดยตรง
        </p>
      </Section>

      <Section title="ข้อมูลสำหรับเด็ก">
        <p>
          แอปนี้ออกแบบให้ผู้ปกครองเป็นผู้สร้างบัญชีและดูแลการใช้งาน
          เรา<b>ไม่เก็บข้อมูลส่วนบุคคลจากเด็กโดยตรง</b> และ
          <b>ไม่แสดงโฆษณาที่ติดตามพฤติกรรม</b>
        </p>
      </Section>

      <Section title="เนื้อหาที่สร้างด้วย AI">
        <p>
          ภาพประกอบ เสียงบรรยาย และเนื้อเรื่องในแอปสร้างขึ้นด้วยปัญญาประดิษฐ์
          เราระบุข้อมูลนี้ไว้ในทุกวิดีโอที่เผยแพร่บนแพลตฟอร์มภายนอก
        </p>
      </Section>

      <Section title="การเผยแพร่บนโซเชียลมีเดีย">
        <p>
          เราเผยแพร่วิดีโอนิทานที่ทีมงานสร้างขึ้นไปยังเพจ Facebook, ช่อง YouTube
          และ TikTok ของเราเอง โดยใช้ API อย่างเป็นทางการของแต่ละแพลตฟอร์ม
        </p>
        <p>
          การเชื่อมต่อนี้ใช้กับ<b>บัญชีของเราเองเท่านั้น</b> —
          เรา<b>ไม่เข้าถึงบัญชีโซเชียลมีเดียของผู้ใช้</b>
          และไม่โพสต์อะไรในนามของผู้ใช้
        </p>
      </Section>

      <Section title="เราไม่ทำอะไรกับข้อมูลของคุณ">
        <ul>
          <li>ไม่ขายข้อมูลให้บุคคลที่สาม</li>
          <li>ไม่ส่งข้อมูลให้ผู้โฆษณา</li>
          <li>ไม่ใช้ข้อมูลนอกเหนือจากการให้บริการในแอป</li>
        </ul>
      </Section>

      <Section title="สิทธิ์ของคุณ">
        <p>
          คุณขอ<b>ดู แก้ไข หรือลบข้อมูล</b>ของคุณได้ทุกเมื่อ
          เมื่อคุณขอลบบัญชี เราจะลบข้อมูลส่วนบุคคลและนิทานทั้งหมดของคุณ
          ภายใน <b>30 วัน</b>
        </p>
      </Section>

      <Section title="ติดต่อเรา">
        <p>
          มีคำถามเกี่ยวกับข้อมูลของคุณ ติดต่อได้ที่{' '}
          <a href="mailto:duanganucha@hotmail.com" style={{ color: '#2563eb' }}>
            duanganucha@hotmail.com
          </a>
        </p>
      </Section>
    </main>
  );
}

function Section({ title, children }) {
  return (
    <section style={{ marginTop: 34 }}>
      <h2 style={{ fontSize: 20, marginBottom: 8 }}>{title}</h2>
      {children}
    </section>
  );
}
