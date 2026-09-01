import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * สถิติเชิงแนวโน้ม — ไม่ระบุตัวตน
 *
 * ตอบคำถามเดียว: "ควรผลิตนิทานแนวไหนต่อ"
 * ไม่มีข้อมูลผู้ใช้รายบุคคลในผลลัพธ์เลย
 */
export async function GET(req) {
  const pool = getPool();
  const days = Math.min(365, Math.max(7, Number(new URL(req.url).searchParams.get('days')) || 90));

  const q = (sql, p = []) => pool.query(sql, p).then(([r]) => r).catch(() => []);

  const [byCategory, byAge, byType, topStories, daily, totals, events] = await Promise.all([
    // ยอดวิวเฉลี่ยต่อเรื่องสำคัญกว่ายอดรวม เพราะบางหมวดมีเรื่องเยอะกว่า
    q(`SELECT COALESCE(category,'(ไม่ระบุ)') AS name, COUNT(*) AS stories,
              SUM(views) AS views, SUM(loves) AS loves,
              ROUND(AVG(views),1) AS avg_views
       FROM stories WHERE status='done'
       GROUP BY category ORDER BY avg_views DESC`),

    q(`SELECT COALESCE(age_range,'(ไม่ระบุ)') AS name, COUNT(*) AS stories,
              SUM(views) AS views, ROUND(AVG(views),1) AS avg_views
       FROM stories WHERE status='done'
       GROUP BY age_range ORDER BY avg_views DESC`),

    q(`SELECT COALESCE(story_type,'(ไม่ระบุ)') AS name, COUNT(*) AS stories,
              SUM(views) AS views, ROUND(AVG(views),1) AS avg_views
       FROM stories WHERE status='done'
       GROUP BY story_type ORDER BY avg_views DESC LIMIT 12`),

    q(`SELECT id, title, category, age_range, views, loves
       FROM stories WHERE status='done'
       ORDER BY views DESC, loves DESC LIMIT 12`),

    // จำนวนเรื่องที่ผลิตต่อวัน — ดูจังหวะการทำงานที่ผ่านมา
    q(`SELECT DATE(created_at) AS d, COUNT(*) AS n
       FROM stories WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
       GROUP BY DATE(created_at) ORDER BY d`, [days]),

    q(`SELECT COUNT(*) AS stories, SUM(views) AS views, SUM(loves) AS loves,
              SUM(status='done') AS done, SUM(status='error') AS error
       FROM stories`),

    // เหตุการณ์ที่เก็บใหม่ (ตารางเพิ่งสร้าง จึงอาจยังว่าง)
    q(`SELECT type, COUNT(*) AS n FROM story_events
       WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
       GROUP BY type`, [days]),
  ]);

  return NextResponse.json({
    days,
    totals: totals[0] || {},
    by_category: byCategory,
    by_age: byAge,
    by_type: byType,
    top_stories: topStories,
    daily,
    events,
    // บอกตรง ๆ ว่าข้อมูลพอเชื่อถือได้แค่ไหน
    note: 'สถิติไม่ระบุตัวตน — ไม่เก็บว่าใครดูอะไร',
  });
}
