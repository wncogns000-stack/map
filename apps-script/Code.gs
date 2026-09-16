/**
 * 우리 반 직업 신청 — 구글 시트에 얹어 배포하는 웹 앱 (Google Apps Script)
 *
 * 화면(index.html)과 자료 보관(구글 시트)을 한곳에서 돌립니다.
 * 배포 한 번이면 주소 하나로 끝나고, 학생들이 각자 태블릿으로 신청한 내용이
 * 선생님 시트에 모입니다. 한 번호로는 한 번만 신청할 수 있습니다.
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
 *  - 같은 번호로 두 번 내려 하면 서버가 막습니다. (태블릿을 바꿔도 마찬가지)
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
  if (action === 'exportsheet') return exportSheet_(req.round);

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

/**
 * 지망 현황을 새 구글 스프레드시트로 만들어 줍니다.
 * 회장·부회장이 직접 배정할 때 보기 좋도록 두 장으로 나눕니다.
 *   1장 "지망 현황"    — 번호순으로 학생별 1·2·3지망
 *   2장 "직업별 신청자" — 직업마다 지망한 학생 명단 (정원과 함께)
 */
function exportSheet_(round) {
  var cfg = readConfig_() || {};
  var jobs = cfg.jobs || [];
  var count = Math.min(Math.max(1, Number(cfg.choiceCount) || 3), 5);
  var asg = readAssignments_();
  var subs = readSubs_().filter(function (s) { return s.round === (Number(round) || 1); })
                        .sort(function (a, b) { return a.number - b.number; });

  function nameOf(key) {
    if (!key) return '';
    for (var i = 0; i < jobs.length; i++) if (jobs[i].id === key) return jobs[i].name;
    return String(key);
  }

  var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var ss = SpreadsheetApp.create('지망현황_' + stamp);

  // --- 1장: 학생별 지망 ---
  var head = ['번호', '이름'];
  for (var i = 0; i < count; i++) head.push((i + 1) + '지망');
  head.push('배정 직업', '제출시각');

  var rows = [head];
  subs.forEach(function (s) {
    var row = [s.number, s.name];
    for (var i = 0; i < count; i++) row.push(nameOf((s.choices || [])[i]));
    row.push(asg[String(s.number)] ? nameOf(asg[String(s.number)]) : '', s.at || '');
    rows.push(row);
  });

  var sh1 = ss.getSheets()[0];
  sh1.setName('지망 현황');
  if (rows.length) sh1.getRange(1, 1, rows.length, head.length).setValues(rows);
  sh1.getRange(1, 1, 1, head.length).setFontWeight('bold').setBackground('#fff0dc');
  sh1.setFrozenRows(1);
  sh1.autoResizeColumns(1, head.length);

  // --- 2장: 직업별 신청자 ---
  var head2 = ['직업', '정원'];
  for (var i = 0; i < count; i++) head2.push((i + 1) + '지망 신청자');
  head2.push('배정된 학생');

  var rows2 = [head2];
  jobs.forEach(function (j) {
    var row = [j.name, j.cap];
    for (var rank = 0; rank < count; rank++) {
      var who = subs.filter(function (s) {
        var k = (s.choices || [])[rank];
        return k === j.id || nameOf(k) === j.name;
      }).map(function (s) { return s.number + '번 ' + s.name; });
      row.push(who.join(', '));
    }
    row.push(subs.filter(function (s) { return asg[String(s.number)] === j.id; })
                 .map(function (s) { return s.number + '번 ' + s.name; }).join(', '));
    rows2.push(row);
  });

  var sh2 = ss.insertSheet('직업별 신청자');
  sh2.getRange(1, 1, rows2.length, head2.length).setValues(rows2);
  sh2.getRange(1, 1, 1, head2.length).setFontWeight('bold').setBackground('#fff0dc');
  sh2.setFrozenRows(1);
  sh2.autoResizeColumns(1, head2.length);

  // 결과 폴더로 옮겨 둡니다.
  try {
    var folders = DriveApp.getFoldersByName(RESULT_FOLDER);
    var folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(RESULT_FOLDER);
    DriveApp.getFileById(ss.getId()).moveTo(folder);
  } catch (err) { /* 폴더 정리에 실패해도 파일은 만들어져 있습니다 */ }

  return { ok: true, url: ss.getUrl(), name: ss.getName(), rows: subs.length };
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
  return sheet_(SHEET_SUBS,
    ['회차', '번호', '이름', '1지망', '2지망', '3지망', '4지망', '5지망', '제출시각', '코드(자동)']);
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
    // 맨 뒤 '코드' 열이 있으면 그것을, 없으면(예전 기록) 지망 열의 값을 씁니다.
    var choices = [];
    if (r[9]) {
      choices = String(r[9]).split('|').filter(function (v) { return v; });
    } else {
      for (var c = 3; c <= 7; c++) if (r[c]) choices.push(String(r[c]));
    }
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
  var ids = rec.choices || [];
  var names = rec.choiceNames && rec.choiceNames.length ? rec.choiceNames : ids;  // 사람이 읽을 값
  subsSheet_().appendRow([
    round, Number(rec.number), String(rec.name),
    names[0] || '', names[1] || '', names[2] || '', names[3] || '', names[4] || '',
    rec.at || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm'),
    ids.join('|')
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
