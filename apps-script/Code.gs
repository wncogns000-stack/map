/**
 * 우리 반 직업 신청 — 공유 모드용 백엔드 (Google Apps Script)
 *
 * 이 파일을 쓰면 학생들이 각자 휴대폰·태블릿으로 신청해도
 * 선생님의 구글 시트 한 곳에 신청 내용이 모입니다.
 *
 * ▣ 설치 방법 (10분)
 *  1. 구글 드라이브에서 새 스프레드시트를 하나 만듭니다. (예: "우리 반 직업 신청")
 *  2. 메뉴 [확장 프로그램] → [Apps Script] 를 엽니다.
 *  3. 기본으로 있는 코드를 지우고 이 파일 내용을 전부 붙여넣고 저장합니다.
 *  4. 오른쪽 위 [배포] → [새 배포] → 유형 [웹 앱] 을 고릅니다.
 *       - 실행 계정: 나
 *       - 액세스 권한: "모든 사용자" (링크를 아는 누구나)
 *  5. [배포]를 누르고 나오는 웹 앱 URL(.../exec)을 복사합니다.
 *  6. 직업 신청 웹앱 → [교사용] → [설정·초기화] → "공유 모드 주소"에 붙여넣고
 *     [공유 모드 켜기]를 누릅니다.
 *  7. 주소창에 생긴 링크(?api=... 포함)를 학생들에게 알려 주세요.
 *
 * ▣ 안전 장치
 *  - 학생 쪽에서는 직업 목록과 "내가 이미 냈는지" 만 확인할 수 있습니다.
 *  - 신청 내용 전체 조회·초기화·설정 변경은 교사 비밀번호가 있어야 합니다.
 *  - 비밀번호는 웹앱의 [설정]에서 바꿀 수 있습니다. (기본값 1234)
 */

var SHEET_SUBS = '신청';
var SHEET_CONF = '설정';

function doGet(e) {
  return json_({ ok: true, message: '직업 신청 백엔드가 작동 중입니다.' });
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    var req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var action = req.action;

    if (action === 'public') return json_({ ok: true, config: publicConfig_() });
    if (action === 'check')  return json_({ ok: true, submitted: hasSubmitted_(req.round, req.number) });
    if (action === 'submit') return json_(submit_(req.record));

    // ---- 아래는 교사 전용 ----
    if (!checkPin_(req.pin)) return json_({ ok: false, error: '비밀번호가 맞지 않습니다.' });

    if (action === 'all')    return json_({ ok: true, submissions: readSubs_(), assignments: readAssignments_(), config: readConfig_() });
    if (action === 'config') { writeConfig_(req.config); return json_({ ok: true }); }
    if (action === 'assign') { writeAssignments_(req.assignments); return json_({ ok: true }); }
    if (action === 'reset')  { resetAll_(req.config); return json_({ ok: true }); }

    return json_({ ok: false, error: '알 수 없는 요청입니다: ' + action });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  } finally {
    try { lock.releaseLock(); } catch (ignore) {}
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ---------------- 시트 도우미 ---------------- */

function ss_() { return SpreadsheetApp.getActiveSpreadsheet(); }

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
  var c = readConfig_();
  var real = (c && c.pin) ? String(c.pin) : '1234';
  return String(pin || '') === real;
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
