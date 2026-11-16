# BuildFlow-ის სერვერზე განთავსება

სერვერი: Windows 11 + Docker Desktop. საიტი: https://siteflow.win (Cloudflare Tunnel).

სტეკი სამი კონტეინერისგან შედგება: `db` (PostgreSQL 18), `app` (BuildFlow) და `cloudflared`
(Cloudflare Tunnel). როუტერზე პორტების გახსნა არ არის საჭირო და აპლიკაცია ქსელში პირდაპირ არ ჩანს.

ყველა ბრძანება გაუშვით PowerShell-ში პროექტის საქაღალდიდან (მაგ. `D:\BuildFlow`).

## 1. კოდის გადმოწერა

```powershell
cd D:\
git clone https://github.com/Mokrinali/BuildFlow.git
cd D:\BuildFlow
```

## 2. Cloudflare Tunnel

1. შედით https://one.dash.cloudflare.com → **Networks → Tunnels → Create a tunnel**.
2. აირჩიეთ **Cloudflared**, სახელი: `buildflow`.
3. „Install and run a connector“ გვერდზე აირჩიეთ **Docker** და დააკოპირეთ ბრძანებიდან მხოლოდ
   token (`--token`-ის შემდეგ მოყოლილი გრძელი ტექსტი). ბრძანება თავად არ გაუშვათ.
4. **Public Hostname**: Domain `siteflow.win`, Subdomain ცარიელი, Service: `HTTP` →
   `app:3000`. თუ `siteflow.win`-ზე უკვე არსებობს DNS ჩანაწერი, Cloudflare შემოგთავაზებთ მის
   ჩანაცვლებას.

token საიდუმლოა: არ გააზიაროთ ჩატში ან ელფოსტით.

## 3. პარამეტრების ფაილი (.env)

```powershell
powershell -ExecutionPolicy Bypass -File deploy\setup.ps1
```

სკრიპტი ქმნის `.env`-ს შემთხვევითი პაროლებით და ითხოვს Cloudflare token-ს (აკრეფისას არ ჩანს).
შეინახეთ `.env`-ის ასლი უსაფრთხო ადგილას (მაგ. პაროლების მენეჯერში).

## 4. გაშვება

```powershell
docker compose up -d --build
docker compose ps
```

პირველ ჯერზე build რამდენიმე წუთი გრძელდება. `docker compose ps`-ში `app` უნდა იყოს
`healthy`, `migrate` — `exited (0)`, ხოლო `db` და `cloudflared` — `running`.

## 5. პირველი ადმინისტრატორი

```powershell
powershell -ExecutionPolicy Bypass -File deploy\create-admin.ps1
```

შემდეგ გახსენით https://siteflow.win და შედით ამ ელფოსტითა და პაროლით. დანარჩენ
თანამშრომლებს ადმინისტრატორი ქმნის გვერდზე „მომხმარებლები“; მათ პირველი შესვლისას პაროლის
შეცვლა მოუწევთ.

სატესტო მონაცემებს (`db:seed`) სერვერზე ნუ გაუშვებთ.

## 6. ავტომატური ჩართვა გადატვირთვის შემდეგ

Docker Desktop Windows 11-ზე მხოლოდ მომხმარებლის შესვლის შემდეგ ირთვება:

1. Docker Desktop → **Settings → General** → ჩართეთ **Start Docker Desktop when you sign in**.
2. Windows-ის ავტომატური შესვლა: `Win+R` → `netplwiz` → მოხსენით
   „Users must enter a user name and password…“ და შეიყვანეთ ანგარიშის პაროლი.
   (ალტერნატივა: სერვერზე ყოველი გადატვირთვის შემდეგ ხელით შესვლა.)
3. კონტეინერებს `restart: unless-stopped` აქვთ, ამიტომ Docker-ის ჩართვისას თავად ირთვებიან.

## 7. სარეზერვო ასლები

ხელით:

```powershell
powershell -ExecutionPolicy Bypass -File deploy\backup.ps1
```

ფაილი ინახება `backups\buildflow-YYYYMMDD-HHmmss.dump`-ში; 30 დღეზე ძველი იშლება.

ყოველდღიურად 03:00-ზე (Task Scheduler, ერთხელ გასაშვები ადმინისტრატორის PowerShell-ში):

```powershell
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '-ExecutionPolicy Bypass -File D:\BuildFlow\deploy\backup.ps1'
$trigger = New-ScheduledTaskTrigger -Daily -At 3am
Register-ScheduledTask -TaskName 'BuildFlow backup' -Action $action -Trigger $trigger -RunLevel Highest
```

სარეზერვო ასლები ამავე დისკზე ინახება. დისკის დაზიანებისგან დასაცავად პერიოდულად
დააკოპირეთ `backups` საქაღალდე სხვა ადგილას (გარე დისკი, ღრუბელი).

### აღდგენა

```powershell
powershell -ExecutionPolicy Bypass -File deploy\restore.ps1 -File backups\buildflow-20261116-030000.dump
```

აღდგენა მიმდინარე მონაცემებს ჩაანაცვლებს. სკრიპტი დადასტურებას ითხოვს (`RESTORE`).

## 8. განახლება

```powershell
powershell -ExecutionPolicy Bypass -File deploy\update.ps1
```

იღებს სარეზერვო ასლს, ჩამოტვირთავს ახალ კოდს GitHub-დან, აწყობს და გადატვირთავს სტეკს.
მიგრაციები ავტომატურად ეშვება.

## პრობლემების დიაგნოსტიკა

```powershell
docker compose ps
docker compose logs --tail 100 app
docker compose logs --tail 100 migrate
docker compose logs --tail 100 cloudflared
```

- `app` არ ირთვება და ლოგში წერია `Invalid production configuration` — შეამოწმეთ `.env`.
- საიტი არ იხსნება, `cloudflared` ლოგში `Unauthorized` — token არასწორია; შეცვალეთ
  `CLOUDFLARE_TUNNEL_TOKEN` `.env`-ში და გაუშვით `docker compose up -d`.
- Cloudflare-ში Public Hostname-ის Service უნდა იყოს ზუსტად `http://app:3000`.
