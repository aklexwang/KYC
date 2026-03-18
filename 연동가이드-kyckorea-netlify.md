# https://kyckorea.netlify.app/ 연동 가이드

KYC 사이트와 가맹점 어드민을 **백엔드 API**와 연동하는 방법입니다.

---

## 1. 현재 상태

| 구분 | 설명 |
|------|------|
| **KYC 사이트** | 프론트만 동작. 완료해도 서버에 저장되지 않음. |
| **가맹점 어드민** | 샘플 데이터로 표시. 실제 회원 데이터 없음. |
| **QR + 가맹점** | 스캔 시 URL의 `store` 파라미터가 `localStorage.kyc_store_id`에 저장됨. |

**연동** = 백엔드(API + DB)를 두고, KYC 완료 시 데이터를 보내고, 어드민에서는 API로 회원 목록을 불러오는 것.

---

## 2. 필요한 것

1. **백엔드 API** (서버 또는 Netlify Functions 등)
   - **KYC 완료 저장**: 회원 이름, 가맹점 ID, 3단계 결과(문자/신분증/계좌)를 DB에 저장
   - **회원 목록 조회**: 가맹점 ID로 해당 가맹점 회원만 조회

2. **API 주소 설정**
   - KYC 사이트: 완료 시 데이터를 보낼 **API 기본 URL**
   - 가맹점 어드민: 회원 목록을 가져올 **API 기본 URL** + (선택) **가맹점 ID**

---

## 3. API 규격 (권장)

### 3-1. KYC 단계별 전송 (KYC 사이트 → 서버)

**POST** `{API_BASE}/api/kyc`

**Body (JSON)**  
- `name`: 문자인증 시 입력한 이름  
- `storeId`: 가맹점 ID (QR의 `store` 파라미터, 없으면 빈 문자열)  
- `sms`: `'complete'` | `'fail'` | `'wait'`  
- `idDoc`: `'complete'` | `'fail'` | `'wait'`  
- `account`: `'complete'` | `'fail'` | `'wait'`

**언제 전송되는지**  
- **문자 인증 완료 후 "다음" 클릭** → 회원이 처음 등록됨. `sms: 'complete'`, `idDoc: 'wait'`, `account: 'wait'`  
- **신분증 인증 성공 후 "다음"** → `idDoc: 'complete'`, `account: 'wait'`  
- **신분증 인증 3회 실패(이용정지)** → `idDoc: 'fail'`  
- **계좌 인증 성공** → `account: 'complete'` (KYC 전체 완료)  
- **계좌 인증 3회 실패** → `account: 'fail'`

서버는 **같은 `name` + `storeId`**가 있으면 기존 레코드를 업데이트(upsert), 없으면 새로 넣으면 됩니다.  
이렇게 하면 **문자 인증만 끝나도 가맹점 어드민에 회원이 보이고**, 이후 단계를 진행할 때마다 상태가 갱신됩니다.

### 3-2. 회원 목록 조회 (어드민 → 서버)

**GET** `{API_BASE}/api/members?store={가맹점ID}`

**응답 (JSON)**  
- `members`: 배열. 각 항목은 `{ name, sms, idDoc, account }`  
- `sms` / `idDoc` / `account`: `'complete'` | `'fail'` | `'wait'`

예:
```json
{
  "members": [
    { "name": "홍길동", "sms": "complete", "idDoc": "complete", "account": "complete" },
    { "name": "김철수", "sms": "complete", "idDoc": "complete", "account": "fail" }
  ]
}
```

---

## 4. 프론트 설정 방법

### 4-1. KYC 사이트 (kyckorea.netlify.app 배포본)

배포되는 **kyc-main.html** 상단(또는 `<head>` 안)에 다음을 넣고, 본인 API 주소로 바꿉니다.

```html
<script>
  window.KYC_API_BASE = 'https://your-api.example.com';  // 백엔드 주소. 비우면 전송 안 함.
</script>
```

- `KYC_API_BASE`를 **비우거나 없으면** KYC 완료 시 API 전송을 하지 않습니다.
- 값을 넣으면, 고객이 **KYC 인증 완료** 화면까지 진행했을 때  
  `POST {KYC_API_BASE}/api/kyc` 로 위 JSON을 보냅니다.

### 4-2. 가맹점 어드민 (admin-store.html)

어드민 페이지 **admin-store.html** 상단(또는 `<head>` 안)에 다음을 넣습니다.

```html
<script>
  window.ADMIN_API_BASE = 'https://your-api.example.com';  // 백엔드 주소
  window.ADMIN_STORE_ID = 'STORE_001';  // 이 가맹점만 보려면 가맹점 ID 지정
</script>
```

- `ADMIN_API_BASE`를 넣으면, 페이지 로드 시  
  `GET {ADMIN_API_BASE}/api/members?store={ADMIN_STORE_ID}` 로 회원 목록을 요청합니다.
- 응답이 오면 그 목록으로 테이블을 채우고,  
  요청 실패나 `ADMIN_API_BASE`가 비어 있으면 기존처럼 **샘플 데이터**를 사용합니다.

---

## 5. 백엔드 구현 예시 (선택)

- **Netlify Functions**: 같은 Netlify 사이트에 `/api/kyc`, `/api/members` 함수를 두고, DB는 Supabase·MongoDB 등 연동.
- **Supabase**: 테이블에 `name`, `store_id`, `sms`, `id_doc`, `account` 컬럼 두고, Functions에서 Supabase 클라이언트로 insert/select.
- **Firebase Firestore**: 비슷한 구조로 문서 저장 후, 어드민에서 `storeId`로 쿼리.

이미 사용 중인 백엔드가 있으면, 위 규격에 맞춰 엔드포인트만 맞추면 됩니다.

---

## 6. 정리

| 하고 싶은 것 | 필요한 작업 |
|--------------|-------------|
| KYC 완료 데이터를 서버에 남기기 | 백엔드에 `POST /api/kyc` 구현 후, KYC 사이트에 `KYC_API_BASE` 설정 |
| 어드민에 실제 회원 보기 | 백엔드에 `GET /api/members?store=...` 구현 후, 어드민에 `ADMIN_API_BASE`·`ADMIN_STORE_ID` 설정 |
| kyckorea.netlify.app와 연동 | 위 API를 Netlify나 다른 서버에 배포하고, 그 주소를 `KYC_API_BASE`·`ADMIN_API_BASE`에 넣으면 연동 완료 |

지금 프로젝트의 **kyc-main.html**과 **admin-store.html**에는 이미 위 API를 호출하는 코드가 들어가 있으므로, **백엔드만 만들고 주소만 설정하면** https://kyckorea.netlify.app/ 와 연동할 수 있습니다.
