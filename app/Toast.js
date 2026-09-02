'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Toast แจ้งผลแบบลอยมุมขวาบน — ใช้ร่วมกันได้ทุกหน้า
 *
 * ใช้งาน:
 *   const [toasts, push] = useToasts();
 *   push({ kind: 'ok', title: 'สำเร็จ', msg: '...' });
 *   <Toasts items={toasts} />
 */
export function useToasts() {
  const [items, setItems] = useState([]);

  function push(t) {
    const id = Date.now() + Math.random();
    // ค้างนานขึ้นถ้าเป็นข้อผิดพลาด เพราะผู้ใช้ต้องอ่านรายละเอียด
    const ttl = t.ttl ?? (t.kind === 'bad' ? 8000 : t.kind === 'warn' ? 7000 : 4500);
    setItems((s) => [...s.slice(-4), { ...t, id }]);
    setTimeout(() => setItems((s) => s.filter((x) => x.id !== id)), ttl);
  }

  function dismiss(id) {
    setItems((s) => s.filter((x) => x.id !== id));
  }

  return [items, push, dismiss];
}

export function Toasts({ items, onDismiss }) {
  // เรนเดอร์ไปที่ <body> ตรง ๆ ไม่ใช่ในตำแหน่งที่ถูกเรียก
  //
  // ทำไม: ถ้า toast อยู่ใน element ที่มี transform / filter / opacity < 1
  // element นั้นจะสร้าง stacking context ใหม่ ทำให้ z-index ของ toast
  // ถูกจำกัดอยู่แค่ในกล่องนั้น ต่อให้ตั้งเป็นค่าสูงสุดก็ยังโดนบัง
  // การส่งไป body ตัดปัญหานี้ถาวร ไม่ว่าหน้าไหนจะเรียกใช้จากตรงไหน
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);   // portal ใช้ได้เฉพาะฝั่ง client

  const stack = (
    <div className="tstack">
      {items.map((t) => (
        <div key={t.id} className={`tcard ${t.kind || 'info'}`}
             onClick={() => onDismiss?.(t.id)} role="status">
          <span className="tico">
            {t.kind === 'ok' ? '✓' : t.kind === 'warn' ? '⚠'
              : t.kind === 'bad' ? '✗' : 'ℹ'}
          </span>
          <div className="tbody">
            {t.title && <div className="ttitle">{t.title}</div>}
            {t.msg && <div className="tmsg">{t.msg}</div>}
            {/* ลิงก์ไปดูของจริง — กดแล้วต้องไม่ปิด toast ทันที */}
            {t.href && (
              <a className="tlink" href={t.href} target="_blank" rel="noreferrer"
                 onClick={(e) => e.stopPropagation()}>เปิดดู →</a>
            )}
          </div>
        </div>
      ))}

      <style jsx>{`
        .tstack {
          position: fixed; top: 18px; right: 18px;
          /* ค่าสูงสุดของ z-index — toast ต้องลอยเหนือทุกอย่างเสมอ
             ไม่ผูกกับเลขของ overlay ตัวใดตัวหนึ่ง เพราะถ้ามีใครเพิ่ม
             overlay z-index สูงกว่าในอนาคต toast จะโดนบังโดยไม่มีใครรู้ */
          z-index: 2147483647;
          isolation: isolate;
          display: flex; flex-direction: column; gap: 9px;
          max-width: min(380px, calc(100vw - 36px));
          pointer-events: none;
        }
        .tlink {
          display: inline-block; margin-top: 5px;
          color: #7dd3fc; font-size: 12px; text-decoration: none;
        }
        .tlink:hover { text-decoration: underline; }
        .tcard {
          pointer-events: auto; cursor: pointer;
          display: flex; gap: 10px; align-items: flex-start;
          background: #16213a; border: 1px solid #334155;
          border-left-width: 3px;
          border-radius: 11px; padding: 11px 13px;
          box-shadow: 0 10px 30px rgba(0, 0, 0, .45);
          animation: tin .22s ease-out;
        }
        @keyframes tin {
          from { opacity: 0; transform: translateX(14px); }
          to { opacity: 1; transform: none; }
        }
        .tcard.ok { border-left-color: #22c55e; }
        .tcard.warn { border-left-color: #f59e0b; }
        .tcard.bad { border-left-color: #ef4444; }
        .tcard.info { border-left-color: #38bdf8; }
        .tico { font-size: 13px; font-weight: 800; line-height: 1.5; flex: 0 0 auto; }
        .tcard.ok .tico { color: #22c55e; }
        .tcard.warn .tico { color: #f59e0b; }
        .tcard.bad .tico { color: #ef4444; }
        .tcard.info .tico { color: #38bdf8; }
        .tbody { min-width: 0; }
        .ttitle { font-size: 13px; font-weight: 600; color: #e2e8f0; }
        .tmsg {
          font-size: 12px; color: #94a3b8;
          margin-top: 2px; line-height: 1.55; word-break: break-word;
        }
      `}</style>
    </div>
  );

  return mounted ? createPortal(stack, document.body) : null;
}
