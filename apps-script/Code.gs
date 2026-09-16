/**
 * 우리 반 직업 신청 — 구글 시트에 얹어 배포하는 웹 앱 (Google Apps Script)
 *
 * 화면(index.html)과 자료 보관(구글 시트)을 한곳에서 돌립니다.
 * 배포 한 번이면 주소 하나로 끝나고, 학생들이 각자 기기로 신청한 내용이
 * 선생님 시트에 모입니다.
 *
 * ▣ 설치 방법 (10분, 한 번만)
 *  1. 구글 드라이브에서 새 스프레드시트를 하나 만듭니다. (예: "우리 반 직업 신청")
 *  2. 메뉴 [확장 프로그램] → [Apps Script] 를 엽니다.
 *  3. 기본으로 있는 코드(Code.gs)를 지우고 이 파일 내용을 전부 붙여넣습니다.
 *  4. 왼쪽 [파일] 옆 [+] → [HTML] 을 눌러 파일을 만들고, 이름을 반드시
 *     "index" 로 합니다. 그 안의 내용을 모두 지우고 index.html 내용을
 *     전부 붙여넣은 뒤 저장합니다.
 *  5. 오른쪽 위 [배포] → [새 배포] → 유형 [웹 앱]
 *       - 실행 계정: 나
 *       - 액세스 권한: "모든 사용자" (링크를 아는 누구나)
 *  6. [배포]를 누르면 나오는 웹 앱 주소(.../exec)가 곧 우리 반 신청 주소입니다.
 *     그 주소를 학생들에게 알려 주세요. 선생님도 같은 주소로 들어가
 *     [교사용]을 누르면 됩니다.
 *
 *  ※ 코드를 고친 뒤에는 [배포] → [배포 관리] → 연필 → 버전 "새 버전" → [배포]
 *     를 해야 바뀐 내용이 반영됩니다.
 *
 * ▣ 안전 장치
 *  - 학생 쪽에서는 직업 목록과 "내가 이미 냈는지" 만 확인할 수 있습니다.
 *  - 신청 내용 전체 조회·초기화·설정 변경은 교사 비밀번호가 있어야 합니다.
 *  - 비밀번호는 이 파일 맨 위의 TEACHER_PIN 값입니다. 바꾸려면 웹앱의
 *    index.html 안 TEACHER_PIN 과 이 파일의 값을 똑같이 고쳐 주세요.
 */

var TEACHER_PIN = '3051';     // 교사용 비밀번호 (웹앱과 같은 값이어야 합니다)

var SHEET_SUBS = '신청';
var SHEET_CONF = '설정';
var RESULT_FOLDER = '직업 신청 결과';   // 결과 문서를 모아 둘 드라이브 폴더
var SHEET_ID = '';                      // 비워 두면 이 스크립트가 붙어 있는 스프레드시트를 씁니다

/** 학생·교사 모두 이 주소로 들어옵니다. */
function doGet(e) {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('우리 반 직업 신청')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** 화면에서 google.script.run.api(...) 로 부르는 창구입니다. */
function api(payloadJson) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    return JSON.stringify(handle_(JSON.parse(payloadJson || '{}')));
  } catch (err) {
    return JSON.stringify({ ok: false, error: String(err && err.message || err) });
  } finally {
    try { lock.releaseLock(); } catch (ignore) {}
  }
}

/** 따로 배포해 쓰는 경우(다른 곳에 올린 화면에서 부르는 경우)를 위한 창구입니다. */
function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    return json_(handle_(JSON.parse((e && e.postData && e.postData.contents) || '{}')));
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  } finally {
    try { lock.releaseLock(); } catch (ignore) {}
  }
}

/** 두 창구가 함께 쓰는 처리기. */
function handle_(req) {
  var action = req.action;

  if (action === 'public') return { ok: true, config: publicConfig_(), webAppUrl: webAppUrl_() };
  if (action === 'check')  return { ok: true, submitted: hasSubmitted_(req.round, req.number) };
  if (action === 'submit') return submit_(req.record);

  // ---- 아래는 교사 전용 ----
  if (!checkPin_(req.pin)) return { ok: false, error: '비밀번호가 맞지 않습니다.' };

  if (action === 'all')      return { ok: true, submissions: readSubs_(), assignments: readAssignments_(), config: readConfig_() };
  if (action === 'config')   { writeConfig_(req.config); return { ok: true }; }
  if (action === 'assign')   { writeAssignments_(req.assignments); return { ok: true }; }
  if (action === 'reset')    { resetAll_(req.config); return { ok: true }; }
  if (action === 'savefile') return saveFile_(req.filename, req.content, req.mime);

  return { ok: false, error: '알 수 없는 요청입니다: ' + action };
}

function webAppUrl_() {
  try { return ScriptApp.getService().getUrl() || ''; } catch (err) { return ''; }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * 결과 문서를 선생님 드라이브에 저장합니다.
 * (웹 앱 화면은 구글이 씌운 틀 안에서 돌기 때문에 브라우저 내려받기가 막힐 수 있습니다)
 */
function saveFile_(filename, content, mime) {
  if (!filename || content == null) return { ok: false, error: '저장할 내용이 없습니다.' };
  var folders = DriveApp.getFoldersByName(RESULT_FOLDER);
  var folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(RESULT_FOLDER);
  var blob = Utilities.newBlob(content, mime || 'application/octet-stream', filename);
  var file = folder.createFile(blob);
  return { ok: true, url: file.getUrl(), name: file.getName() };
}

/* ---------------- 시트 도우미 ---------------- */

function ss_() {
  return SHEET_ID ? SpreadsheetApp.openById(SHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
}

function sheet_(name, header) {
  var sh = ss_().getSheetByName(name);
  if (!sh) {
    sh = ss_().insertSheet(name);
    if (header) sh.appendRow(header);
  }
  return sh;
}

function subsSheet_() {
  return sheet_(SHEET_SUBS, ['회차', '번호', '이름', '1지망', '2지망', '3지망', '4지망', '5지망', '제출시각']);
}

function confSheet_() { return sheet_(SHEET_CONF, ['key', 'value']); }

function readKV_(key) {
  var sh = confSheet_(), values = sh.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) if (values[i][0] === key) return values[i][1];
  return '';
}

function writeKV_(key, value) {
  var sh = confSheet_(), values = sh.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (values[i][0] === key) { sh.getRange(i + 1, 2).setValue(value); return; }
  }
  sh.appendRow([key, value]);
}

/* ---------------- 설정 ---------------- */

function readConfig_() {
  var raw = readKV_('config');
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (err) { return null; }
}

function writeConfig_(config) {
  if (!config) return;
  writeKV_('config', JSON.stringify(config));
}

/** 학생에게 내려보내는 설정 — 비밀번호는 제외합니다. */
function publicConfig_() {
  var c = readConfig_();
  if (!c) return null;                 // 웹앱의 기본 직업 목록이 쓰입니다.
  var copy = JSON.parse(JSON.stringify(c));
  delete copy.pin;
  copy.hasPin = true;
  return copy;
}

function checkPin_(pin) {
  return String(pin || '') === TEACHER_PIN;
}

/* ---------------- 신청 ---------------- */

function readSubs_() {
  var sh = subsSheet_(), values = sh.getDataRange().getValues(), out = [];
  for (var i = 1; i < values.length; i++) {
    var r = values[i];
    if (!r[1] && r[1] !== 0) continue;
    var choices = [];
    for (var c = 3; c <= 7; c++) if (r[c]) choices.push(String(r[c]));
    out.push({
      round: Number(r[0]) || 1,
      number: Number(r[1]),
      name: String(r[2] || ''),
      choices: choices,
      at: r[8] ? String(r[8]) : ''
    });
  }
  return out;
}

function hasSubmitted_(round, number) {
  var subs = readSubs_();
  for (var i = 0; i < subs.length; i++) {
    if (subs[i].round === (Number(round) || 1) && subs[i].number === Number(number)) return true;
  }
  return false;
}

function submit_(rec) {
  if (!rec || !rec.number || !rec.name) return { ok: false, error: '이름과 번호를 확인해 주세요.' };
  var round = Number(rec.round) || 1;
  if (hasSubmitted_(round, rec.number)) {
    return { ok: false, error: '이미 그 번호로 신청했어요. 선생님께 말씀드리세요.' };
  }
  var ch = rec.choices || [];
  subsSheet_().appendRow([
    round, Number(rec.number), String(rec.name),
    ch[0] || '', ch[1] || '', ch[2] || '', ch[3] || '', ch[4] || '',
    rec.at || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm')
  ]);
  return { ok: true };
}

/* ---------------- 배정 결과 ---------------- */

function readAssignments_() {
  var raw = readKV_('assignments');
  if (!raw) return {};
  try { return JSON.parse(raw); } catch (err) { return {}; }
}

function writeAssignments_(map) { writeKV_('assignments', JSON.stringify(map || {})); }

/* ---------------- 초기화 ---------------- */

/**
 * 신청 기록과 배정 결과를 지웁니다.
 * 지우기 전 자동으로 "보관_날짜" 시트에 사본을 남겨 두므로,
 * 실수로 눌러도 지난 달 기록을 다시 볼 수 있습니다.
 */
function resetAll_(config) {
  var sh = subsSheet_();
  if (sh.getLastRow() > 1) {
    var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd_HHmm');
    sh.copyTo(ss_()).setName('보관_' + stamp);
    sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).clearContent();
  }
  writeAssignments_({});
  if (config) writeConfig_(config);
}
