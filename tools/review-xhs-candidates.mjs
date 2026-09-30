import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const candidates = JSON.parse(await readFile(path.join(root,'data/xhs-candidates.json'),'utf8'));
const places = JSON.parse(await readFile(path.join(root,'data/places.json'),'utf8'));
const placeIds = new Set(places.map((p)=>p.id));
const threshold = { likes: 200, saves: 100 };
const allowedStatus = new Set(['awaiting_original_note','ready_for_mapping','rejected']);
const ids = new Set();
const report = [];
for (const note of candidates) {
  if (!note.id || ids.has(note.id) || !allowedStatus.has(note.status)) throw new Error(`候选 ID 或状态异常：${note.id}`);
  ids.add(note.id);
  if (!/^https:\/\/www\.xiaohongshu\.com\/explore\/[a-f0-9]{24}$/.test(note.noteUrl)) throw new Error(`原帖地址异常：${note.id}`);
  if (!placeIds.has(note.anchorPlaceId)) throw new Error(`地图参考点不存在：${note.id}`);
  if (!Array.isArray(note.routeStops) || !note.routeStops.every((id)=>placeIds.has(id))) throw new Error(`路线节点未定位：${note.id}`);
  const engagementVerified = Number.isInteger(note.likes) && note.likes >= 0 && Number.isInteger(note.saves) && note.saves >= 0 && /^\d{4}-\d{2}-\d{2}$/.test(note.engagementCheckedAt ?? '') && note.engagementEvidence === note.noteUrl;
  const passesThreshold = engagementVerified && note.likes >= threshold.likes && note.saves >= threshold.saves;
  const mappable = passesThreshold && note.noteBodyVerified === true && note.routeStops.length >= 2 && note.status === 'ready_for_mapping';
  report.push({ id:note.id, anchorPlaceId:note.anchorPlaceId, noteUrl:note.noteUrl, engagementVerified, passesThreshold, mappable, reason:mappable?'可供人工复核后入正式路线': !engagementVerified?'原帖互动数未核实': !passesThreshold?'低于试点阈值': !note.noteBodyVerified?'原帖路线正文未核实':'路线节点或状态未就绪' });
}
const out = path.join(root,'generated');
await mkdir(out,{recursive:true});
await writeFile(path.join(out,'xhs-review.json'),JSON.stringify({threshold,checkedAt:new Date().toISOString().slice(0,10),report},null,2)+'\n');
console.log(`小红书候选 ${report.length} 条；互动数达标 ${report.filter((r)=>r.passesThreshold).length} 条；可试画 ${report.filter((r)=>r.mappable).length} 条`);
for (const row of report) console.log(`${row.id}: ${row.reason}`);
