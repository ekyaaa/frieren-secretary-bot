# PRD FINAL — Frieren Discord Logbook Automation

> Versi: **2.0 / baseline implementasi**  
> Tanggal: **11 November 2026**  
> Bahasa dokumen: Indonesia; **seluruh pesan Frieren kepada user: English-only**  
> Status: **requirements disepakati, belum berarti sudah dikembangkan/deploy**  
> Pemilik produk: operator server pribadi  
> Rujukan: [bot-services](https://github.com/Oktavian19/bot-services), [logbook-cli](https://github.com/Oktavian19/logbook-cli), [DERMAGA](https://jti.polinema.ac.id/dermaga/login)

## 0. Ringkasan perubahan dibanding PRD sebelumnya

Dokumen ini **menggantikan** `FRIEREN_DISCORD_LOGBOOK_SPEC.md` v1.0. Perubahan yang telah dikonfirmasi:

1. **Tidak ada login web untuk pengguna biasa**. Seluruh onboarding, konfigurasi, pengingat, review, persetujuan, edit, konfirmasi, dan bukti screenshot berlangsung lewat Discord; folder lokal dipilih melalui GUI Local Agent.
2. **Seluruh pengingat dan konfirmasi bersifat privat melalui Discord DM**. Interaksi command dari channel dapat memakai ephemeral acknowledgement yang mengarahkan pengguna ke DM; background job tidak dapat mengirim ephemeral.
3. **Channel server hanya untuk checklist terjadwal dan ping terakhir**; tidak pernah memuat isi deskripsi, password, API key, screenshot privat, atau rincian commit.
4. **Sumber Git selalu berada di laptop user**; Local Agent lintas OS membaca repo lokal dan mengirim metadata yang disetujui. VPS tidak mengakses path lokal secara langsung.
5. **Distribusi Local Agent dari tombol Discord**. Jika attachment installer melebihi batas Discord, gunakan tautan rilis resmi dari tombol sebagai fallback. Tidak wajib membuka dashboard.
6. **Dashboard web hanya untuk admin platform**, dengan static username `atmin` dan password `password123` yang dibaca dari `.env` pada deployment sesuai keputusan operator; tidak ada Discord OAuth untuk dashboard. Ini bukan kredensial yang boleh ditanam ke source code.
7. Infrastruktur admin menggunakan **Tailscale Funnel yang sudah disiapkan operator**, termasuk fakta bahwa Funnel adalah **akses internet publik**, bukan isolasi tailnet. Tidak mengganti desain ini menjadi Serve tanpa izin operator.
8. **Playwright harus me-refresh/reopen halaman monitoring DERMAGA sebelum screenshot** dan memverifikasi record pengguna/tanggal/isi dari DOM setelah pemuatan ulang; jangan screenshot hanya dari notifikasi POST sukses.
9. **Per-user**: reminder default **16:00 WIB**, jam masuk **07:10**, jam pulang **16:25**, hari aktif **Senin–Jumat**, auto-submit **OFF secara default**, tenggat review **15 menit** setelah DM reminder terkirim sukses.
10. Persona dan interaksi Gemini menggunakan file `@docs/frieren_system_prompt_english.md` dan `@docs/frieren_gemini_example_english.md` sebagai source of truth, dengan aturan resmi logbook berbeda dari persona.

## 1. Visi, outcome, batasan

### 1.1 Visi

Bangun layanan **Frieren Discord Logbook** yang mendukung banyak pengguna dan banyak Discord guild: pengguna memasang Local Agent di laptop, memilih project Git, memasukkan kredensial DERMAGA dan Gemini pribadi melalui Discord, menerima draft logbook harian via DM, dapat mengedit/menyetujui/mengirim manual, atau mengaktifkan auto-submit. Backend mengirim ke DERMAGA, memverifikasi data dengan membuka ulang monitoring, merekam screenshot Playwright, kemudian menyampaikan bukti via DM. Admin memantau pengguna, guild, scheduler, agent, logbook, dan error melalui dashboard privat-berpassword yang diekspos lewat Funnel.

### 1.2 Definisi keberhasilan

- Tidak ada pengguna reguler yang perlu membuka dashboard web.
- Pengguna Windows/Linux dapat memasang agent dari distribusi Discord dan memilih repository melalui GUI, tanpa menyunting JSON atau terminal.
- User teridentifikasi stabil oleh Discord snowflake `user_id`; satu identitas bisa menjadi anggota banyak guild.
- DM harian membawa draft yang dapat direview. Posting channel hanya berisi checklist dan last reminder.
- Submission tidak pernah dianggap `VERIFIED` sebelum DERMAGA dibaca ulang dan record yang cocok benar-benar terlihat.
- Screenshot yang dibagikan di DM hanya menunjukkan bukti pengguna bersangkutan dan menyertakan tanggal/verifikasi yang jelas.
- Auto-submit tidak menggandakan entri, tidak memakai draft kosong, dan tidak menebak pekerjaan/kehadiran.
- Persona Frieren terjaga pada reminder, progress, success, error, dan chat; deskripsi kerja yang disubmit tetap formal dalam bahasa Indonesia.

### 1.3 Bukan tujuan (non-goals)

- Mengakses filesystem laptop dari cloud tanpa Local Agent.
- Mengambil seluruh source code pengguna atau push repo ke backend.
- Menjalankan shell command arbitrer dari pesan Discord.
- Memalsukan commit, kehadiran, GPS, waktu kerja, atau keberhasilan portal.
- Pengelolaan dashboard oleh pengguna biasa, Discord OAuth web, atau migrasi data Telegram otomatis tanpa mapping yang disetujui.
- Otomasi tanda tangan/approval pihak DERMAGA kecuali ada izin dan requirement terpisah.

## 2. Landasan repository yang telah diperiksa

Pemeriksaan dilakukan terhadap branch `main` repositori yang diberikan saat menyusun spesifikasi. Agen implementasi **harus memeriksa ulang revision/branch aktual**, jangan menganggap kode masih sama.

| Sumber | Komponen saat ditinjau | Sikap implementasi |
|---|---|---|
| `bot-services` | Python, aiogram Telegram, aiohttp, APScheduler, SQLite | Ekstraksi logika domain DERMAGA, tidak perlu mengulang login/CSRF dari nol |
| `app/services/logbook_service.py` | `test_dermaga_login`, `fetch_dermaga_table`, `check_monitoring_today`, `submit_dermaga_entry`; endpoint login/monitoring/submit | Adaptasi signature dari `chat_id` Telegram ke `user_id` internal; audit hasil HTTP 200 dan GPS jitter |
| `app/database/logbook_repo.py` | Kredensial terenkripsi, draft, state reminder, profil lokasi, token API | Migrasi ke schema Discord baru, device token terpisah, guild relation, audit |
| `app/services/logbook_api.py` | Bearer token, `POST /api/logbook`, idempotency key | Ubah ke ingestion authenticated per-device, no Telegram assumptions |
| `app/services/scheduler.py` | Reminder harian serta pengingat verifikasi mingguan | Durable jobs, 15 menit, fanout guild checklist, recovery restart |
| `logbook-cli/logbook_cli.py` | Discovery Git lokal, scan per tanggal, summary, queue offline, update/release | Reuse domain Git & pending queue; bangun GUI local agent + auto-start |
| `logbook-cli` | AI sebelumnya memakai endpoint OpenAI-compatible | Untuk versi baru, panggil Gemini dari backend berdasarkan commit snapshot; **API key user tidak dikirim ke laptop** |

**Catatan:** bagian `magang_archived.py` di `bot-services` bukan modul utama yang digunakan. Endpoint DERMAGA yang diketahui dari kode lama:

- `https://jti.polinema.ac.id/dermaga/login`
- `https://jti.polinema.ac.id/dermaga/mahasiswa/monitoring`
- `https://jti.polinema.ac.id/dermaga/mahasiswa/monitoring/simpan`

Akses dan markup portal live dapat berubah. Implementasi harus menggunakan fixture/contract tests dan adaptasi jika diperlukan. Hindari agresif login/scrape serta jangan menyiasati CAPTCHA/MFA bila muncul.

## 3. Aktor dan hak akses

| Aktor | Hak | Tidak boleh |
|---|---|---|
| Discord user terdaftar | Setup akun sendiri, pairing device sendiri, edit setting/draft sendiri, generate/submit/cek bukti sendiri, chat dengan Frieren | Baca/mengubah kredensial, project, screenshot user lain |
| Guild admin dengan izin konfigurasi | Menentukan channel checklist, jadwal checklist, waktu final ping, kebijakan mention, mengaktifkan integrasi guild | Melihat password/API key dan DM member; membaca screenshot pribadi tanpa izin |
| Platform admin (dashboard) | Melihat guild/user registry, status agent, jadwal, logs redacted, submission, retry operasional; mengubah pengaturan yang diizinkan | Mengakses credential plaintext melalui UI/API, menjalankan shell remote arbitrer |
| Local Agent | Scan path allowlisted pada mesin yang dipasangkan, mengirim metadata commit dan heartbeat milik user/device | Scan folder lain; eksekusi perintah server yang tidak di-allowlist; membaca token agent lain |
| Frieren bot / scheduler | Menerbitkan reminder DM, memproses tombol, menyimpan state, mengirim checklist & last ping | Mengirim data sensitif ke channel; menandai verified tanpa bukti |

**Identitas:** `discord_user_id` unik global sebagai string; `guild_id` string dan `guild_memberships(guild_id,user_id)` many-to-many. `guild_config` terpisah. Setiap user memilih **home guild** untuk preferensi konteks/label, namun reminder DM hanya **sekali per user/tanggal**, tidak digandakan karena banyak guild. Checklist satu kali per guild sesuai roster eligible di guild tersebut.

## 4. Pengalaman Discord dan distribusi Local Agent

### 4.1 Prinsip Discord-first

- Pesan yang diciptakan oleh scheduler dikirim via **DM biasa**, bukan ephemeral.
- Pada guild, `/setup` atau `/logbook` bisa membalas **ephemeral** agar tidak memenuhi channel dan menjelaskan bahwa proses berlanjut di DM; data personal tetap DM.
- Untuk password/API key: gunakan **Discord modal** bila interaksi tersedia; jangan minta mengetik password sebagai plain channel message. Input modal ditangani privat, tidak dimasukkan ke audit/chat history, tidak pernah di-echo. Jelaskan kepada user bahwa modal adalah input tersembunyi dari channel, bukan pengganti enkripsi backend.
- Bila DM tidak terbuka (`cannot_send_messages`): tampilkan petunjuk pada interaksi awal secara ephemeral, catat `DM_BLOCKED`, sediakan `/setup` untuk memulihkan; jangan mengklaim reminder diterima atau diam-diam melakukan auto-submit pada siklus gagal-DM.
- Tombol dan modal harus memakai custom ID opaque/stateful, ownership check, expiry, replay protection, dan rate-limit.

### 4.2 Instal agent tanpa dashboard

1. User menjalankan `/setup start` atau klik tombol **Start Setup** dari channel bot.
2. Bot membuat DM wizard, menyampaikan info yang masih kurang tanpa membocorkan secret.
3. User menekan **Install Agent** / `/agent install` dan memilih **Windows** atau **Linux**.
4. Bot mengirim installer executable/package sebagai **attachment DM** bila ukuran/jenis file diizinkan dan sudah ada rilis yang diverifikasi. Jika tidak, bot mengirim tombol direct-download GitHub Releases yang berasal dari pipeline rilis resmi (tanpa login dashboard).
5. Installer membuka aplikasi lokal dengan UI sederhana: pilih satu atau lebih folder project, lihat daftar repo Git terdeteksi, preview commit, atur auto-start, sync test.
6. User menekan `/agent pair` pada DM; kode pairing sekali pakai diberikan via DM, TTL 5 menit, tidak diekspose di channel, disimpan hash di server.
7. User memasukkan kode pairing ke agent. Agent menukar kode melalui HTTPS dengan **device token** terbatas pada `user_id/device_id`, disimpan aman di OS credential store bila tersedia (fallback file permission ketat dan penjelasan risiko).
8. Agent melakukan heartbeat dan scan, server menyimpan `last_seen`, `last_sync`, `last_commit_count`, path alias (jangan minta upload path lengkap jika tidak diperlukan), version.
9. User menyelesaikan koneksi DERMAGA, lokasi authorized jika diperlukan, Gemini key, dan konfigurasi lain dari DM wizard.
10. `/setup status` mengonfirmasi `READY` atau menampilkan syarat yang belum terpenuhi.

**Batasan nyata:** bot VPS tidak dapat membaca `C:/Projects/...` atau `/home/user/...` langsung. Agent yang offline tidak bisa dipaksa scan. Perintah sync dari Discord hanya menciptakan **sync request yang diambil agent saat online**, bukan remote shell.

### 4.3 Pengaturan wajib dan default

| Field | Sumber | Default | Wajib diisi pengguna? | Catatan |
|---|---|---|---|---|
| Discord User ID | Discord interaction | otomatis | Tidak | Immutable primary identifier; username/avatar display-only |
| Discord guild ID dan membership | Discord events | otomatis | Tidak | Bisa multi guild; refresh membership saat dibutuhkan |
| Home guild | Pilihan jika >1 | guild pertama yang disetujui | Hanya jika ambigu | Tidak membuat DM ganda |
| DERMAGA username | Discord modal | kosong | **Ya** | Validasi login sebelum READY |
| DERMAGA password | Discord modal | kosong | **Ya** | Enkripsi at rest, masked, rotate/revoke |
| Gemini API key pribadi | Discord modal | kosong | **Ya menurut scope semula** | Encrypted; fallback last setelah pool server gagal; bila tanpa key, bisa tersedia basic manual mode tetapi tidak READY auto-generate |
| Folder project | Local Agent GUI | kosong | **Ya** | Bisa beberapa, folder induk discovery dengan batas kedalaman |
| Device ID/hostname alias | Local Agent | otomatis | Tidak | Agent hanya membaca allowlisted repos |
| Hari kerja | User settings | Senin–Jumat | Tidak | Boleh Senin–Minggu/none |
| Jam reminder | User settings | **16:00 WIB** | Tidak | Timezone `Asia/Jakarta` default |
| Jam masuk | User settings | **07:10** | Tidak | HH:mm lokal |
| Jam pulang | User settings | **16:25** | Tidak | HH:mm lokal |
| Auto-submit | User settings | **OFF** | Tidak | Explicit opt-in, kapan pun bisa dibatalkan sebelum dispatch |
| Rentang konfirmasi | Platform policy | **15 menit** | Tidak | T+15 dari sukses kirim reminder DM |
| Profil lokasi | DM settings | kosong | Bila DERMAGA mewajibkan | Jangan membuat/men-jitter koordinat palsu |
| Source server/guild untuk laporan | guild membership/home guild | otomatis | Tidak jika tunggal | Pilih kalau user aktif di >1 guild dan diperlukan |

**Konflik jadwal yang harus ditangani:** default reminder **16:00** + review **15 menit** berarti auto-submit paling awal 16:15, sedangkan jam pulang default **16:25**. Untuk menghindari pelaporan waktu selesai yang masih di masa depan, *job auto-submit dipicu* pada T+15 tetapi **ditahan dengan state `AWAITING_WORK_END` hingga jam pulang yang benar**, sehingga earliest send default menjadi 16:25. User menerima pesan transparan. Tombol **Submit Now** sebelum jam pulang harus memperingatkan dan menuntut penyesuaian jam berdasarkan fakta, bukan memalsukan jam. Ini adalah **eligibility safety gate**, bukan perubahan durasi review.

## 5. Fitur fungsional lengkap

### F01 — Onboarding & account

- Wizard DM per-user dengan progress step, resume setelah restart.
- Validasi login DERMAGA, status kredensial, penggantian password, penghapusan akun (revoke agent/key, data retention policy).
- User tidak melihat dashboard publik/admin.
- Pairing, unpair, multi-device per user (maksimum dikonfigurasi), audit device.
- Per-user readiness gating; user boleh chat atau memakai manual mode sebelum agent READY.

### F02 — Git Local Agent & source selection

- Windows x64 dan Linux x64 pada fase awal; macOS opsi fase berikutnya.
- Instalasi GUI lokal; auto-start opsi, manual Scan Now, tray/background bila platform mendukung, heartbeat periodik.
- Scan repo atau folder induk (depth bounded), per date range timezone, author filtering (Git email/name mapping), branch policy configurable (HEAD / all refs dengan dedup hash), symlink and path traversal guard.
- Kirim `commit hash`, timestamp, author identifier yang disetujui, subject/body, repo alias, optional changed-file summary; tidak mengirim isi file penuh, remote origin URL privat, token Git, atau `.env`.
- Opsional preview commit sebelum kirim; rekam `snapshot_hash` dan provenance.
- Offline queue terenkripsi jika memungkinkan, idempotent resend setelah internet hidup, pause/resume sync, error UI.
- Update agent signed/checksum verified jika memungkinkan; release via CI, file installer dari repo resmi.
- `agent sync` dari Discord membuat request yang dibaca agent pada poll/heartbeat, bukan shell command.

### F03 — AI summary formal untuk logbook

- Kumpulkan **seluruh commit yang relevan dalam tanggal target**, across selected repos, dedup, gunakan subject+body (optional stat file) dan user notes.
- Model Gemini menghasilkan ringkasan **formal berbahasa Indonesia** berdasarkan sumber yang tersedia; jangan memasukkan persona Frieren, tidak boleh mengarang tugas.
- Prompt formal terpisah pada `@docs/LOGBOOK_FORMAL_PROMPT.md`, dan output divalidasi terhadap schema (`summary`, `source_commit_ids`, `warnings`).
- Jika commit kosong, tawarkan manual input; jangan auto-generate laporan fiktif.
- Redact potential secrets in commit text before API submission; batasi panjang/context dan log redaction.
- Regenerate menambah draft revision, tidak silently overwrite approved revision.
- Simpan model/key source (ID bukan key), prompt version, input hash, output, run cost/error metadata (tanpa secret).

### F04 — Persona Frieren, Gemini routing, dan conversational memory

- **Source of truth:** `@docs/frieren_system_prompt_english.md` (English-only, calm, observant, subtly playful, transparent AI), `@docs/frieren_gemini_example_english.md` (JS integration reference, bukan kode drop-in: rename/adapt dan review sesuai SDK terpasang).
- **Bot replies English-only** untuk chat, reminders, confirmations, errors, verification, technical help. UI command tetap dapat bernama English; user text bahasa lain tidak mengubah bahasa persona.
- Gemini digunakan sebagai style layer untuk teks otomatis dan chat, **backend event adalah otoritas fakta**. Jangan biarkan AI memilih status/menjalankan aksi.
- Global Gemini keys urut **key 1..N dari `.env`**, setelah semua gagal dengan error yang bisa di-retry lanjut **key user**. Jangan rotasi untuk non-retryable/invalid request/safety. Batas timeout, quota rate, backoff jitter, key health/cooldown.
- Pisahkan key-selection untuk `persona` vs `logbook_summary` agar provider accounting dan ekspektasi jelas; aturan fallback sama tetapi log/audit terpisah.
- Bila seluruh key tidak tersedia: persona memakai template English fallback deterministik yang jujur; generator laporan meminta manual review atau draft non-AI berlabel jelas dan **tidak layak auto-submit tanpa approval eksplisit**.
- DM chat dengan context ringkas N pesan terakhir dari DM thread milik user, TTL/retention dan token budget; mention/reply di guild hanya mengambil channel context yang bot boleh baca dan dengan Message Content intent jika relevan/diizinkan. Jangan menggabungkan percakapan lintas user atau guild tanpa izin.
- Mendukung mention dan reply ke bot, merespons dengan Frieren. Tidak menjalankan script dari percakapan bebas.

### F05 — Reminder dan review pribadi melalui DM

- Pada hari aktif dan waktu yang diatur, scheduler memeriksa status DERMAGA, state harian, snapshot commit/agent, dan draft.
- Jika belum dikirim, kirim **DM** berisi draft (jika siap), tanggal, jam kerja, project, edit button, regenerate, approve/send, skip, snooze, status agent.
- Timer review 15 menit **mulai ketika DM sukses dikirim** dan disimpan `delivered_at`; tidak dimulai bila Discord API mengembalikan DM blocked/failed.
- Bila tidak ada commit terbaru, DM harus jujur: `Agent offline/no commits; manual input required`; tidak membuat fake draft.
- User bisa approve dan send sebelum deadline, menunda, membatalkan auto untuk hari itu, atau mengedit: saat editing, kunci otomatisasi untuk revisi lama sampai edit selesai/dibatalkan.
- Pesan DM jangan spam; reminder satu per user/tanggal; dedup berdasarkan `user_id,date,event_type`.
- Manual mode tetap tersedia untuk hari lampau dengan tanggal eksplisit dan fitur penyesuaian yang diotorisasi DERMAGA.

### F06 — Auto-submit T+15, manual submit, dan approvals

- Mode `auto_submit_enabled` hanya aktif setelah user memberi izin eksplisit, default OFF.
- Auto job diciptakan setelah reminder DM berhasil; **T+15 menit merupakan review deadline**, lalu cek readiness/eligibility; jika jam pulang di masa depan, tahan hingga waktunya (lihat §4.3).
- Sebelum dispatch: re-read user settings (auto masih ON?), draft revision masih sama? editing/snooze/skip? present date & working time valid? already DERMAGA? DM delivered? agent snapshot acceptable? web login okay? acquire per-user/date lock?
- Manual submit memerlukan tombol konfirmasi final dari pemilik revision. Bot memberi feedback running vs success terpisah.
- Idempotency key mengikat `user_id`, `date`, `portal_account`, logical entry scope; perubahan draft tidak boleh tanpa sengaja membuat duplicate entry. Retry setelah timeout **reconcile portal lebih dulu**, jangan blind re-post.
- Portal request HTTP 200 **bukan** bukti final tersimpan.
- Setelah tombol cancel/skip, scheduler tidak mengirim secara otomatis; manual submit bisa dilakukan dengan langkah baru yang eksplisit.

### F07 — DERMAGA integration & verification via Playwright

**Workflow wajib untuk pengiriman:**

1. Ambil user credential terenkripsi, decrypt hanya di worker server untuk sesi HTTPS DERMAGA; login dan CSRF sesuai portal.
2. Fetch monitoring `before` untuk mengetahui apakah record untuk tanggal tersebut sudah ada. Bila ada, reconcile status atau minta jalur edit sesuai izin, bukan menciptakan double entry.
3. Submit form dengan tanggal, jam masuk/pulang, deskripsi formal dan lokasi yang benar menurut user; simpan `attempt_id`, request time dan response classification.
4. Setelah respons, **buka ulang monitoring secara fresh** (`page.goto(monitoring_url)` atau `page.reload()` setelah transisi yang tepat), tunggu DOM relevan, bukan hanya AJAX notification, dan jangan hanya mengandalkan state lama.
5. Cari baris/card logbook berdasarkan **akun yang login + tanggal + konten/jam yang cocok**; jika row HTML berubah, adaptasi selector berbasis role/text/table bukan CSS rapuh.
6. Jika ditemukan, simpan `VERIFIED` dan hash record/body, waktu verifikasi, screenshot viewport/element yang cukup untuk memperlihatkan tanggal dan isi, serta metadata `screenshot_sha256`.
7. Screenshot melalui `locator.screenshot()` atau `page.screenshot()` dengan konteks yang membuktikan hasil **setelah refresh**; crop/redact NIM/private info lain bila tidak dibutuhkan.
8. Kirim screenshot ke **DM pemilik**, dengan status yang jelas (English Frieren). Screenshot hanya berasal dari backend dan user-level authorization, bukan channel guild.
9. Jika record tidak muncul, tandai `UNVERIFIED`/`PENDING_RECONCILE`, retry baca dengan bounded backoff. Jangan kirim ulang POST sampai status portal dipastikan.
10. Jika verified tapi screenshot gagal, status `VERIFIED_SCREENSHOT_FAILED`/flag evidence pending; data berhasil tersimpan namun bukti perlu retry. Jangan melaporkan submit gagal.

**Dilarang:** menandai `VERIFIED` berdasarkan HTTP 200 saja; mengambil SS sebelum refresh; mengirim screenshot full dashboard dengan data orang lain; menampilkan credentials di screenshot/log.

### F08 — Channel guild: checklist dan final ping SAJA

- Platform dapat berada di banyak guild. Masing-masing guild menentukan `checklist_channel_id`, `checklist_time`, `last_ping_time`, timezone (default Asia/Jakarta), hari aktif, mention policy.
- Checklist channel **satu kali terjadwal** per guild/hari, menampilkan roster peserta **yang mengaktifkan integrasi** di guild, dengan status: ✅ verified, 🟡 pending/unverified, ❌ belum, ⚪ skipped/leave; bedakan `submitted` dari `verified` agar tidak memberi false positive.
- Sesuai permintaan awal, **checklist boleh me-mention semua peserta yang terdaftar pada guild itu** (bukan `@everyone` seluruh guild), sesuai pengaturan guild dan batas Discord; mention hanya snowflake yang terdaftar, sanitasi `allowedMentions`, jumlah/rate limit.
- Pada `last_ping_time`, kirim **satu ping terakhir hanya kepada member yang belum `VERIFIED`** (atau status yang dipilih admin guild), bukan isi draft. Suppress duplicates berdasarkan guild/date/type.
- Bila manual submit di portal, reconcile dahulu agar orang yang telah mengisi tidak ditag sebagai belum. Jika portal tak bisa dicek, tulis `verification pending` daripada menyebut gagal.
- Guild admin mengubah schedule via slash command (`/guild ...`) dan platform admin dapat via dashboard. Pengguna biasa mengatur reminder DM dari `/settings ...`; **bukan dari dashboard**.
- Jika satu user berada di dua guild, DM sekali; status user bisa muncul di checklist kedua guild bila enrolled di keduanya, karena checklist per-guild.
- Channel hanya aggregator status, tidak ada proses setup credentials/logbook description/screenshot, dan tidak dipakai untuk reminder harian pribadi.

### F09 — Admin web monitoring (single platform admin)

- Frontend dashboard hanya untuk admin; user biasa tidak punya route login atau halaman settings web.
- Login credential dari `.env` (kasus deployment operator: `ADMIN_DASH_USERNAME=atmin`, `ADMIN_DASH_PASSWORD=password123`), **tidak** berasal dari Discord OAuth. Tidak boleh ada hardcoded credential fallback dalam source; jika env kosong startup auth harus gagal aman.
- Deployment melewati **Tailscale Funnel yang sudah ada**, jangan mengubah konfigurasi Tailscale existing tanpa instruksi. Service mendengar loopback; Funnel terminate HTTPS ke listener lokal; trust proxy headers hanya dari reverse proxy yang dikonfigurasi.
- Dashboard: overview pengguna/guild, server detail & membership, agent online/offline, reminder schedule per user, checklist/final ping per guild, draft/submission/evidence statuses, error logs redacted, activity audit, key pool health tanpa nilai key, queue health, manual safe reconcile/retry.
- Admin dapat melihat screenshot yang diotorisasi kebijakan platform dalam konteks audit, dengan akses login; key/password tetap masked dan tidak dapat di-reveal melalui UI.
- Sediakan password hash KDF comparison meskipun secret disuplai `.env` (hindari plaintext dalam DB); session signed/httpOnly/secure/SameSite, CSRF, logout, rate limit, audit. Password `password123` adalah **pilihan operator berisiko tinggi** bila Funnel public; dokumentasikan risiko tanpa mengubah pilihannya diam-diam.
- Dashboard layout desktop/mobile, refresh status manual/live polling sederhana. Screenshot admin dan detail DM tidak boleh dikirim ke Discord channel.

### F10 — Reliability, observability, safety

- Durable job queue (Postgres-backed atau pilihan ekuivalen) dengan retry/backoff, lock per user/date, idempotency dan crash recovery.
- Discord REST rate limit & allowedMentions; rate limit Gemini, DERMAGA, dan local agent.
- Validasi credential login, session expiration, updated CSRF, HTML parsing breakage, schema checks.
- Audit trail: who, guild, action, date, revision, result, timestamp, error category; **jangan log password/token/API key/raw headers atau commit sensitif**.
- Monitoring logbook `last_verified_at`, `last_screenshot_at`, screenshots access-controlled, retention dapat dikonfigurasi (mis. 30 hari default, hapus on request).
- Manual pause/resume scheduler per guild/user, daily freeze, kill-switch integrasi DERMAGA jika portal berubah.
- Saat website down, tampilkan `UNVERIFIED/ERROR_RETRYABLE` jujur. Jangan auto-submit berulang saat tidak tahu status.

## 6. Diagram arsitektur target

```mermaid
flowchart TD
  U[Discord User] -->|Slash / DM / buttons / modals| B[Discord Bot (discord.js)]
  L[User Laptop: Local Agent GUI] -->|HTTPS device token / commits / heartbeat| API[Authenticated API]
  B <--> API
  API --> DB[(Postgres: users, guilds, drafts, jobs, audit)]
  API --> Q[Durable Scheduler / Workers]
  Q --> G[Gemini Client: persona + formal summary]
  Q --> DW[DERMAGA Worker]
  DW -->|HTTP session / CSRF / submit| W[DERMAGA Portal]
  DW -->|Playwright fresh open / refresh / DOM verify / screenshot| W
  Q -->|Verified evidence + status| B
  B -->|Private reminder, approval, screenshot| U
  B -->|Checklist + last ping only| CH[Guild Channel]
  A[Platform Admin] -->|Funnel + static env login| WEB[Admin Dashboard]
  WEB --> API
```

**Preferred implementation** (agen boleh mengusulkan tradeoff, tetapi harus mempertahankan behavior): Node.js + TypeScript `discord.js` bot, `@google/genai` untuk komunikasi Frieren, Fastify API/backend, Postgres + durable jobs, React/Vite admin, Python Local Agent (reuse Git CLI logic), Python stateless DERMAGA worker (reuse existing Python portal services), Playwright untuk bukti. Boleh memilih alternatif hanya setelah menjelaskan alasan dan mempertahankan kemampuan reuse repository.

## 7. State machine dan jadwal

### 7.1 State utama (per user + tanggal + portal account)

```text
NOT_DUE
  -> REMINDER_PREPARING
  -> DM_DELIVERED / DM_BLOCKED
  -> DRAFT_READY / NEEDS_MANUAL_INPUT / AGENT_OFFLINE / AI_UNAVAILABLE
DRAFT_READY
  -> EDITING -> DRAFT_READY (new revision)
  -> APPROVED -> QUEUED_SUBMIT
  -> AUTO_WAITING (if opt-in and DM delivered)
  -> SNOOZED / SKIPPED / AUTO_CANCELLED
AUTO_WAITING -> REVIEW_DEADLINE_REACHED -> AWAITING_WORK_END (if needed)
AUTO_WAITING|AWAITING_WORK_END -> QUEUED_SUBMIT (only if eligible)
QUEUED_SUBMIT -> SUBMITTING -> SUBMITTED_UNVERIFIED
SUBMITTED_UNVERIFIED -> RECONCILING -> VERIFIED / UNVERIFIED_RETRYABLE / NEEDS_ATTENTION
VERIFIED -> SCREENSHOT_PENDING -> VERIFIED_EVIDENCE_READY / VERIFIED_SCREENSHOT_FAILED
VERIFIED_EVIDENCE_READY -> DM_EVIDENCE_SENT / DM_EVIDENCE_FAILED
```

`VERIFIED` adalah status bisnis: record nyata ada di portal. `DM_EVIDENCE_SENT` hanya status notifikasi, bukan status submission. `SUBMITTED_UNVERIFIED` tidak dianggap selesai untuk checklist verified.

### 7.2 Sequence waktu default (contoh pengguna auto ON)

| Waktu WIB | Tindakan | Guard |
|---|---|---|
| 15:xx | Agent telah sync commit lokal | Agent online, per-device auth, dedup |
| 16:00 | DM Frieren berisi review & tombol | Hari aktif, belum VERIFIED, DM dikirim sukses |
| 16:15 | Review deadline T+15 dan auto-submit eligibility check | Auto ON, bukan editing/skip, revision valid, data tersedia |
| 16:15–16:25 | `AWAITING_WORK_END` jika jam pulang 16:25 | Tidak mencatat jam pulang di masa depan |
| >=16:25 | Submit DERMAGA ketika semua guard lolos | Reconcile existing entry dan idempotency |
| Setelah submit | Buka ulang monitoring, refresh, verify DOM, screenshot | Bukan hanya notifikasi simpan |
| Setelah bukti | Kirim DM screenshot & status | Kirim privat only |
| Per guild sesuai jadwal | Checklist peserta | Data portal status / cache staleness jelas |
| Per guild waktu terakhir | Mention member yang belum verified | One message/day, dedup, no private detail |

### 7.3 Transisi keamanan dan perubahan setting

- Mengubah `auto_submit_enabled` dari ON ke OFF membatalkan jobs pending yang belum `SUBMITTING`.
- Memulai `EDITING` mengunci revision lama; auto resume hanya ketika revisi baru selesai dan user aware.
- `SNOOZE` memindah deadline secara durable; `SKIP` menutup reminder hari itu tanpa merekayasa submission.
- Regenerate tidak mengganti revision approved. Auto submit hanya revision yang disetujui atau ditetapkan oleh opt-in yang jelas.
- User remove guild: hapus dari checklist guild, jangan hapus logbook global dan DM account otomatis.
- Agent offline: gunakan snapshot bertimestamp bila valid dan user telah menyetujui; default tidak auto-submit jika snapshot stale/empty.
- Portal submit timeout: reconcile via fresh read sebelum request POST selanjutnya.

## 8. Katalog slash command, tombol, modal

> Nama command di bawah adalah kontrak antarmuka produk. Seluruh output Frieren user-facing berbahasa Inggris sesuai prompt karakter. Perintah dapat dijalankan dari DM; jika dimulai di server, balasan awal ephemeral dan percakapan privat berlanjut di DM.

### 8.1 Onboarding & akun

| Command | Deskripsi | Scope |
|---|---|---|
| `/help` | Perintah & panduan singkat | DM / ephemeral |
| `/setup start` | Mulai/resume wizard DM, tombol install & koneksi akun | DM / ephemeral |
| `/setup status` | Checklist readiness, error setup | DM |
| `/setup reset` | Hapus data setup setelah double confirmation | DM |
| `/account connect` | Modal username/password DERMAGA, test login | DM + modal |
| `/account test` | Uji ulang akses portal tanpa menampilkan password | DM |
| `/account change-password` | Modal password DERMAGA baru | DM + modal |
| `/account disconnect` | Revoke credential dari bot, konfirmasi | DM |

### 8.2 Agent dan project

| Command | Deskripsi | Scope |
|---|---|---|
| `/agent install` | Tombol Windows/Linux, attachment installer atau official release fallback | DM |
| `/agent pair` | One-time code + TTL, klaim device | DM |
| `/agent status` | Device, last heartbeat, last sync, version | DM |
| `/agent sync` | Buat sync request untuk agent, **bukan remote shell** | DM |
| `/agent devices` | Daftar perangkat user | DM |
| `/agent revoke device:<id>` | Cabut device token | DM |
| `/projects list` | Daftar repo alias tersinkron dari agent | DM |
| `/projects select` | Aktif/nonaktif repo untuk ringkasan | DM |
| `/projects commits date:<YYYY-MM-DD>` | Preview commit metadata sesuai hari & filter | DM |

### 8.3 Logbook

| Command | Deskripsi | Scope |
|---|---|---|
| `/logbook today` | Status dan jadwal hari ini | DM |
| `/logbook generate date:<...>` | Generate formal AI draft dari snapshot commit | DM |
| `/logbook preview date:<...>` | Isi draft + source & tombol | DM |
| `/logbook regenerate date:<...>` | Revisi AI baru, bukan overwrite approved | DM |
| `/logbook manual date:<...>` | Modal deskripsi manual saat offline/zero commit | DM + modal |
| `/logbook edit date:<...>` | Modal edit summary, time, location | DM + modal |
| `/logbook approve date:<...>` | Approve revision, tidak otomatis menyatakan terkirim | DM |
| `/logbook submit date:<...>` | Konfirmasi pengiriman manual ke DERMAGA | DM |
| `/logbook cancel-auto date:<...>` | Matikan auto job untuk hari itu | DM |
| `/logbook snooze minutes:<15|30|60>` | Tunda reminder/deadline valid | DM |
| `/logbook skip date:<...>` | Lewati satu tanggal (tidak submit) | DM |
| `/logbook status date:<...>` | Status portal/agent/evidence | DM |
| `/logbook history` | Riwayat, pagination | DM |
| `/logbook verify date:<...>` | Fresh reconcile DERMAGA read-only | DM |
| `/logbook screenshot date:<...>` | Download bukti existing atau retry capture | DM |
| `/logbook retry date:<...>` | Retry aman: reconcile dahulu, tidak duplicate POST | DM |

### 8.4 Setting per-user (tidak lewat web)

| Command | Deskripsi |
|---|---|
| `/settings view` | Semua konfigurasi non-rahasia, keys masked |
| `/settings reminder time:HH:mm` | Ubah jam DM default 16:00 |
| `/settings days` | Multi-select hari Senin–Minggu |
| `/settings hours start:HH:mm end:HH:mm` | Default 07:10–16:25 |
| `/settings auto-submit enabled:true|false` | Opt-in/out auto-submit |
| `/settings gemini-key` | Modal API key user; hanya tampil masked setelah disimpan |
| `/settings location` | Pilih lokasi yang benar/authorized |
| `/settings home-guild` | Pilih guild preferensi pengguna |
| `/settings timezone` | Default Asia/Jakarta; valid IANA zone |
| `/settings notifications` | Pause/unpause DM reminder tanpa mematikan manual commands |

### 8.5 Setting guild (hanya admin guild)

| Command | Deskripsi |
|---|---|
| `/guild status` | Status integrasi, channel & jadwal |
| `/guild channel` | Pilih channel khusus checklist/last ping |
| `/guild checklist time:HH:mm` | Jadwal posting checklist guild |
| `/guild final-ping time:HH:mm` | Jadwal last mention guild |
| `/guild mentions mode:all-participants|missing-only|none` | Checklist mention policy; last ping missing-only |
| `/guild participants` | Lihat peserta enrolled (tanpa private content) |
| `/guild pause enabled:true|false` | Pause posting guild, tidak menghapus DM user |

### 8.6 Admin platform

| Command | Deskripsi |
|---|---|
| `/admin health` | Queue/backend/gateway/portal/agent summary |
| `/admin jobs` | Pending/retry/dead letter (redacted) |
| `/admin reconcile date:<...>` | Start safe reconciliation khusus admin |
| `/admin report` | Ringkasan verified per guild (tanpa credential) |

### 8.7 Tombol & modal standar

- `Start Setup`, `Install Agent`, `Windows`, `Linux`, `Pair Device`, `Connect DERMAGA`, `Set Gemini Key`, `Choose Working Days`.
- `Review Draft`, `Edit`, `Regenerate`, `Approve`, `Submit Now`, `Snooze`, `Skip Today`, `Cancel Auto-Submit`, `Verify Again`, `View Screenshot`.
- Semua tombol mengikat server-signed action token/user ownership/revision id; expired button dijawab sopan dengan status terkini.

## 9. Persona: contoh peristiwa (English only)

**Private DM reminder — draft ready:**

> Oh, you have a logbook draft waiting for you. I gathered your commits for today, but you should still give it a look. You have fifteen minutes before automatic submission is considered, if you've enabled it.

**Draft generated:**

> Oh? That went well. I prepared your draft from 6 commits across 2 projects. Take a look and tell me if anything important is missing.

**Auto-submit held because workday not finished:**

> Your review window is over, but your scheduled workday ends at 16:25. I'll wait until then before trying to submit. There's no need to claim you've finished early.

**Portal verified with screenshot:**

> It's there. I refreshed the DERMAGA monitoring page and found your entry for today. I've attached the screenshot so you can check it yourself. Nicely done.

**Portal uncertain:**

> The portal answered, but I couldn't confirm that your entry appeared after refreshing the page. I won't call it complete yet. I'll check again before attempting another submission.

**Agent offline:**

> I haven't heard from your laptop agent recently, so I can't see today's latest commits. You can reconnect it or write the report manually.

**Fallback Gemini issue:**

> The conversation service isn't responding right now. I can still show you the verified status and available actions, but I won't make up a result.

No `Master~`, no repetitive catchphrases, no roleplay in DERMAGA summary. Text above hanyalah ilustrasi—Gemini boleh memvariasikan kata tetapi fakta wajib sesuai event backend.

## 10. Database konseptual

| Table | Key/field esensial |
|---|---|
| `users` | `discord_user_id PK`, `discord_name_cache`, `timezone`, `home_guild_id`, `setup_status`, timestamps |
| `guilds` | `guild_id PK`, `name_cache`, `owner_id_cache`, `installed_at`, `status` |
| `guild_memberships` | `guild_id`, `user_id`, `enrolled`, `last_seen`, composite unique |
| `guild_configs` | `guild_id`, `checklist_channel_id`, `checklist_time`, `last_ping_time`, `days`, `mention_policy`, `enabled` |
| `user_settings` | `user_id`, `reminder_time`, `working_days`, `start_time`, `end_time`, `auto_submit_enabled`, `timezone`, `location_profile_id` |
| `dermaga_credentials` | `user_id`, `username_encrypted`, `password_encrypted`, `last_validation_at`, `auth_status` |
| `gemini_user_keys` | `user_id`, `encrypted_key`, `key_fingerprint`, `updated_at`, `status` |
| `agents` | `device_id PK`, `user_id`, `version`, `platform`, `token_hash`, `last_seen`, `last_sync`, `revoked_at` |
| `agent_pairing_codes` | `id`, `user_id`, `code_hash`, `expires_at`, `claimed_at`, `attempts` |
| `repositories` | `repo_id`, `user_id`, `device_id`, `alias`, `branch_policy`, `author_filter`, `enabled` |
| `commit_snapshots` | `snapshot_id`, `user_id`, `target_date`, `repo_ids`, `metadata_json`, `digest`, `captured_at`, `source_device_id` |
| `logbook_entries` | `entry_id`, `user_id`, `target_date`, `portal_account_id`, `status`, `active_revision_id`, `verified_at`, `portal_record_id`, unique user/date/portal scope |
| `logbook_revisions` | `revision_id`, `entry_id`, `summary`, `work_start`, `work_end`, `location`, `source`, `approved_at`, `created_at` |
| `delivery_events` | `id`, `entry_id`, `type`, `discord_message_id`, `delivered_at`, `error_code`, unique dedup key |
| `submission_attempts` | `attempt_id`, `entry_id`, `revision_id`, `idempotency_key`, `portal_response_kind`, `started_at`, `completed_at`, `error` |
| `evidences` | `evidence_id`, `entry_id`, `screenshot_private_path`, `sha256`, `verified_record_digest`, `captured_after_refresh_at`, `retention_until` |
| `scheduled_jobs` | durable queue job id + state/attempt/execute_at/dedup |
| `guild_daily_checklists` | `guild_id`, `date`, `type`, `post_message_id`, `state`, unique |
| `audit_events` | `actor_type/id`, `object_type/id`, `event`, `trace_id`, sanitized metadata, timestamp |
| `conversation_turns` | `user_id`, `guild_id?`, `channel_id`, `role`, `content_redacted`, `expires_at` |

**DB invariants:** never store device access token plaintext; username/password/encrypted Gemini key storage; unique logical entry and guild checklist event; authorized evidence path; no cross-user JOIN leak; optimistic concurrency revision lock; all timestamps UTC in DB, formatted via IANA timezone at display.

## 11. API high-level contracts

**Agent API** (bearer device token after pairing):

```text
POST /api/v1/agent/pair/claim               {code, device_pub_id, platform, version}
POST /api/v1/agent/heartbeat                {device_id, version, status}
GET  /api/v1/agent/sync-requests           -> allowlisted sync requests
POST /api/v1/agent/commit-snapshots        {target_date, repos, commits, digest, idempotency_key}
GET  /api/v1/agent/config                  -> sync policy (NO Gemini/DERMAGA secrets)
```

**Internal bot/backend API** (internal service credentials, not public user-accessible):

```text
POST /internal/v1/logbooks/generate        {user_id, target_date, snapshot_id}
POST /internal/v1/logbooks/:id/approve     {actor_id, revision_id}
POST /internal/v1/logbooks/:id/submit      {actor_id, revision_id, action_token}
POST /internal/v1/logbooks/:id/reconcile   {actor_id, request_id}
POST /internal/v1/logbooks/:id/evidence    {actor_id, request_id}
GET  /internal/v1/users/:id/setup
GET  /internal/v1/users/:id/status
```

**Dashboard admin API** (authenticated admin session only): `/admin/api/overview`, `/admin/api/guilds`, `/admin/api/users`, `/admin/api/agents`, `/admin/api/logbooks`, `/admin/api/jobs`, `/admin/api/health`, `/admin/api/audit`, with cursor/pagination, redacted outputs, explicit RBAC.

API details and sample payloads ada di `@docs/ARCHITECTURE_AND_API.md`. Semua agent-facing internet routes butuh HTTPS, rate limit, schema validation, authn/authz, request-size limit. Nama endpoint adalah rancangan, bukan kontrak dari DERMAGA.

## 12. Admin dashboard & deployment

- Service backend dan admin UI pada host pribadi operator; Funnel yang sudah tersedia melakukan forwarding ke loopback backend admin.
- `ADMIN_DASH_USERNAME=atmin` dan `ADMIN_DASH_PASSWORD=password123` dibaca dari `.env` untuk environment operator sesuai permintaan; **jangan hardcode** di kode atau expose melalui public repo, screenshot, CLI output atau log.
- `Funnel` membuat endpoint dapat dibuka dari internet umum meskipun berjalan di mesin Tailscale. Keputusan operator tetap digunakan; implementasi menambahkan HTTPS proxy trust, brute-force throttling, session HTTP-only, CSRF, audit, dan pengamanan login.
- API publik local agent sebaiknya punya ingress hostname HTTPS yang stabil. **Jangan anggap URL admin Funnel otomatis cocok untuk API agent**; pisahkan `/api/v1/agent/*` dari `/admin/*` secara routing dan auth, boleh satu host/proxy dengan path segmentation jika operator menginginkan.
- Dashboard admin tidak punya OAuth Discord; user identity berasal dari Discord bot events.
- Deployment Docker Compose + migrations + health checks + volume evidence private + Postgres + worker + bot + dashboard. Script deploy tidak menimpa Tailscale config existing.
- Sediakan backup data Postgres, environment template tanpa key sungguhan, logging rotation, rollback plan, versioned DB migrations.

## 13. Keamanan & audit (risk acceptance)

Operator telah menyatakan menerima risiko penggunaan kredensial admin yang sederhana pada server pribadi. Implementasi **mengikuti pilihan operator** tanpa terus memaksa ganti. Namun risk acceptance tidak membenarkan menyimpan password di repo atau membuka endpoint tanpa session validation.

- DERMAGA credentials dan Gemini keys: encrypt at rest; key enkripsi server dari `.env`/secret store, tidak dapat diambil via dashboard.
- `password123`: simpan hanya `.env` pada host; `.env.example` boleh memakai placeholder, sementara panduan deployment menjelaskan nilai pilihan operator. Tetap wajib rate limiting.
- User pairing token: single-use, 5m TTL, hash at rest, bounded attempts, revoke, support multiple devices.
- Agent network: outbound HTTPS, TLS verification ON, no remote shell; signed metadata schema, nonce/dedup.
- Screenshot: private path, controlled access, redact surrounding personal data, configurable retention, no anonymous URL.
- LLM: commit text & Discord history dianggap untrusted; tidak boleh menjadi higher-priority instructions, actions require backend-confirmed buttons.
- Git: allowlisted folders only, symlink safety, no reading `.env`, no file contents unless explicit future feature.
- System: per-guild membership verification on every guild action; per-user revision binding; job lock across workers.
- Auth: dashboard auth uses env credentials, secure sessions, login attempt throttle, CSRF, logout, hard timeout; webhook/agent API separate from dashboard session.
- Logs: never print raw secrets, csrf tokens, cookies, auth headers, or full screenshots.

## 14. Edge cases minimum

| Kasus | Perilaku wajib |
|---|---|
| DM closed | `DM_BLOCKED`; jangan start review timer/auto-submit; setup recovery via ephemeral on user command |
| Agent offline / laptop mati | Last-sync status jujur, manual input fallback, no fabricated commits |
| Agent baru sync setelah 16:00 | Draft boleh diperbarui; user diberi tahu; jangan auto-overwrite revision approved |
| Tidak ada commit hari itu | Manual mode; no auto report generation as fake work |
| Gemini semua key error | Template persona deterministik; summary manual/non-AI label, no silent auto-submit |
| Gemini user key invalid | Tandai key invalid, DM instruksi update, jangan expose value |
| User tergabung 3 guild | Satu DM; 3 checklist scoped sesuai enrollment, bukan 3 DM |
| Channel checklist tidak bisa ditulis bot | Guild status error; admin diberi petunjuk permission, bukan DM spam user |
| Guild roster berubah | Use current membership / filtered enrolled; prevent mention ex-members |
| Discord 429/outage | Respect retry-after/backoff; no fake DM delivered |
| DERMAGA HTTP 200 tanpa record | `SUBMITTED_UNVERIFIED`, retry GET/reconcile, no success claim |
| DERMAGA POST timeout | Fresh portal read before trying another POST |
| Portal record found but screenshot fails | `VERIFIED_SCREENSHOT_FAILED`, retry screenshot only, no repost |
| Screenshot old cached page | Invalid evidence; must fresh navigate/reload plus DOM verified |
| Duplicate click/queue retry | Idempotent processing, one logical submission |
| User editing at review deadline | Auto held, warn user and require fresh revision confirmation |
| Workday end after T+15 | Hold until end-time and verify no fake time reporting |
| Wrong location/GPS profile | Prompt correction, do not synthesize fake GPS/jitter |
| Backend restart at 16:14 | Durable jobs resume and recalc expiry |
| Password changed DERMAGA | Mark auth invalid; request update via modal |
| User leaves guild / deletes account | Revocation and roster cleanup, preserve audit according policy |

## 15. Nonfunctional requirements

- **NFR-01:** All bot interactions ACK/defer within Discord interaction limits; long work async with status DM.
- **NFR-02:** DM reminder generated once/user/date; checklist and last ping once/guild/date/type with recovered posts after crashes.
- **NFR-03:** Device API schema validates request data, rate limits per device, encrypted transport.
- **NFR-04:** Container worker can run Playwright Chromium headless under limited system user with persisted, private evidence volume.
- **NFR-05:** Tests not dependent on live DERMAGA, Discord, or Gemini API keys; mock portal fixtures, fake clocks.
- **NFR-06:** Privacy defaults: `allowedMentions.parse=[]` except explicit scoped member mention; no secret in log.
- **NFR-07:** Admin UI responsive, accessible keyboard navigation, redacted copy actions and secrets never revealed.
- **NFR-08:** Timezone stored explicitly, avoid system-local fallback, handle date boundaries/daylight changes in other zones.
- **NFR-09:** Reconciliation and screenshot bounded retries; never exponential portal load.
- **NFR-10:** Setup docs for Windows/Linux agent, migrations and operational runbook.

## 16. Phased delivery roadmap

| Fase | Deliverables | Exit criteria |
|---|---|---|
| Phase 0 — Discovery | Audit existing repos, ADR, data model, interface mocks, test fixtures and env | Plan & task list reviewed; verified repo assumptions |
| Phase 1 — Foundation | TS Discord shell, Postgres schema, backend API, DM onboarding, guild config, admin static login | Multi-guild identity secure, dashboard login works, users no web needed |
| Phase 2 — Local Agent | Windows/Linux GUI, pairing, repo discovery, scan, offline queue, CI artifacts | Two local clients isolated; commit snapshot ingested correctly |
| Phase 3 — AI & reminders | Gemini pool/fallback, separate formal summary, DM reminder/edit/approve, scheduler T+15 | Fake-clock test confirms timer, stale/no commit, no double DM |
| Phase 4 — DERMAGA + evidence | Python domain reuse, submit + re-fetch, Playwright fresh DOM verify, screenshot DM | Fixture integration success/failure; no false verified |
| Phase 5 — Guild & admin | Checklist/all participant mentions, last ping missing-only, status dashboard/logs | Guild-specific roster isolation and proper mention behavior |
| Phase 6 — Hardening/release | Docker Compose, Tailscale Funnel guide, CI builds, integration/e2e tests, backup/runbook | Reproducible build/test; no secrets committed; traceable acceptance matrix |

## 17. Acceptance criteria (user scenarios)

- **AC-01:** Member guild A memakai `/setup start`, menerima DM, mengunduh Windows/Linux agent, pairing dan memilih Git folder tanpa membuka dashboard.
- **AC-02:** Member menyimpan akun DERMAGA & Gemini via modal; password/key tidak muncul dalam channel, DM bot, dashboard atau logs.
- **AC-03:** Satu user di 2 guild menerima **satu** DM reminder pada 16:00 di hari aktif.
- **AC-04:** User dapat generate, regenerate, edit, manual, approve, submit, skip, snooze, status dan screenshot dari DM.
- **AC-05:** Mode auto ON + DM delivered 16:00 -> deadline 16:15; bila jam pulang 16:25, dispatch ditahan sampai >=16:25; edit/skip/disable mencegah send.
- **AC-06:** Mode auto OFF -> tidak ada POST tanpa konfirmasi manual.
- **AC-07:** DERMAGA POST sukses tapi GET refresh tidak menemukan entri -> tidak ada status VERIFIED, tidak ada pesan bohong berhasil.
- **AC-08:** Setelah fresh reload DOM menemukan record cocok, screenshot setelah refresh dikirim ke DM user yang benar; channel tidak menerima screenshot.
- **AC-09:** Screenshot gagal sesudah record verified -> tetap VERIFIED dengan evidence pending, tidak retry POST.
- **AC-10:** Guild A checklist mention semua peserta aktif saat jadwal jika policy all-participants; last ping hanya missing; guild B roster tidak bocor.
- **AC-11:** Dashboard login `atmin` / `.env` password yang dipasang operator berhasil; user normal tidak bisa login. Funnel tidak diasumsikan privat.
- **AC-12:** Key pool env digunakan key1..keyN lalu user key hanya untuk retryable failures; jika semua gagal, fallback tidak mengarang.
- **AC-13:** Reply dan mention Frieren mempertahankan batas konteks, English-only, event-based facts, anti-prompt-injection.
- **AC-14:** Agent offline, backend reboot, Discord outage dan portal timeout tidak menyebabkan duplikasi atau kehilangan state.
- **AC-15:** Credential, key, pairing dan screenshot tidak bocor pada log, API, dashboard, channel atau installer artifacts.

Lihat matriks pengujian rinci pada `@docs/TEST_PLAN_AND_ACCEPTANCE.md`.

## 18. Remaining implementation decisions (asumsi yang boleh dipilih agent)

Kebutuhan produk di atas sudah final dari diskusi. Keputusan berikut **bukan blocker meminta user mengulang informasi**: agen implementasi boleh memilih dengan catatan ADR dan alasan:

1. Monorepo vs adapter/service repo terpisah (prefer monorepo baru yang mereuse kode kedua repo lama).
2. Penyimpanan device token Windows Credential Manager / Linux Secret Service dengan fallback secret-file per platform.
3. Format installer (`.exe`/`.msi`, `.deb`/`.AppImage`/`.tar.gz`) dan fallback GitHub Releases jika Discord attachment tidak bisa.
4. Polling interval/heartbeat, queue provider, migration tool, bentuk web framework dan DB transaction layer.
5. Waktu checklist dan final ping default per guild (tidak ditetapkan eksplisit oleh pengguna): sebaiknya disabled hingga admin guild mengisi jam; jangan mengarang jadwal operasional.
6. Screenshot crop strategy dan retention default sesuai UI portal serta kebijakan admin.
7. Tipe input lokasi yang diizinkan DERMAGA; bila perlu, minta nilai dari user dan selalu gunakan lokasi yang benar.

**Tidak boleh diubah secara diam-diam:** DM privat, channel hanya checklist/ping, refresh-before-screenshot, admin-only web dengan static `.env`, Funnel yang sudah ada, 15m review, key rotation, identitas global Discord ID, Git lokal dengan agent, English-only persona.

## 19. Referensi kontrak dan dokumen pendukung

- `@docs/ANTIGRAVITY_IMPLEMENTATION_PROMPT.md` — prompt eksekusi Antigravity (entrypoint).
- `@docs/ARCHITECTURE_AND_API.md` — komponen, auth, API, DB invariants, Playwright flow.
- `@docs/TEST_PLAN_AND_ACCEPTANCE.md` — skenario test dan gating fase.
- `@docs/DEPLOYMENT_AND_SECURITY.md` — `.env`, Funnel, install/release, operasi.
- `@docs/LOGBOOK_FORMAL_PROMPT.md` — instruksi generator deskripsi resmi, bukan persona.
- `@docs/frieren_system_prompt_english.md` — persona dari user, **jangan rephrase tanpa izin**.
- `@docs/frieren_gemini_example_english.md` — contoh kode Gemini dari user, treat as reference; validasi SDK.
- `https://www.antigravity.google/docs/artifact-review/` — Antigravity Planning Mode & review artifacts.
- `https://tailscale.com/docs/features/tailscale-funnel` — Funnel public, Serve private.
- `https://playwright.dev/python/docs/screenshots` — screenshot after navigation & DOM verification.
- `https://ai.google.dev/gemini-api/docs` — SDK dan model ID harus divalidasi aktual pada waktu implementasi.
