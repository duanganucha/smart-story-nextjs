// Story generation by shelling out to ~/bin/sut-gen-story.py (SUT GenAI).
import { execFile } from 'child_process';
import { promisify } from 'util';
import os from 'os';
import path from 'path';

const execFileP = promisify(execFile);

function pythonBin() {
  return process.env.PYTHON || 'python3';
}
function scriptPath() {
  return process.env.SUT_STORY_SCRIPT || path.join(os.homedir(), 'bin', 'sut-gen-story.py');
}

// Returns { title, story, moral[], image_description }
export async function generateStoryViaSut({ topic, imagePath, student_name, story_type, language, paragraphs, age, category, model }) {
  const args = [
    scriptPath(),
    '--student', student_name || 'นักเรียน',
    '--type', story_type || 'นิทาน',
    '--lang', language || 'thai',
    '--paragraphs', String(paragraphs || 6),
    '--age', String(age || '6-8'),
  ];
  if (category) args.push('--category', String(category));
  if (imagePath) args.push('--image', imagePath);
  else args.push('--topic', topic || '');
  if (model) args.push('-m', model);

  const { stdout } = await execFileP(pythonBin(), args, {
    maxBuffer: 16 * 1024 * 1024,
    timeout: 200000,
  });
  const out = stdout.trim();
  let obj;
  try {
    obj = JSON.parse(out);
  } catch {
    const m = out.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('sut-gen-story.py did not return JSON: ' + out.slice(0, 200));
    obj = JSON.parse(m[0]);
  }
  return {
    title: obj.title || '',
    story: obj.story || '',
    moral: Array.isArray(obj.moral) ? obj.moral : [],
    image_description: obj.image_description || '',
  };
}
