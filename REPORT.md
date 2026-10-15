# PIN AUDIO / VOICE — FINAL FIX (ანგარიში)

## ⚠️ რას ეფუძნება
ვმუშაობდი **ერთადერთ ხელმისაწვდომ `src.rar`-ზე** (მხოლოდ `src/`, `package.json`-ის გარეშე). შენი უახლესი working copy
ჩემთვის ხელმისაწვდომი არ იყო. ამიტომ ცვლილებები ლოკალურია და მოყვება `PIN-AUDIO-FINAL-FIX.patch`.
თუ შენი უახლესი `ExamDriveSession.tsx` / `audio.ts` / `route-audio.ts` განსხვავდება — **ფაილები ნუ გადააწერ, patch გამოიყენე**:

    cd <project-root>
    patch -p1 < PIN-AUDIO-FINAL-FIX.patch      # ან: git apply PIN-AUDIO-FINAL-FIX.patch

ან თუ ფაილები იდენტურია — უბრალოდ დააკოპირე `src/` საქაღალდე პროექტის ზემოდან.

## რა იპოვა ანალიზმა (მიზეზები) და რა შეიცვალა

| # | პრობლემა | შესწორება |
|---|---|---|
| 2 | trigger = 5 მ → რეალურ GPS-ზე (±5–15 მ, 1 Hz) ხშირად არასდროს ხვდებოდა | `AUDIO_TRIGGER_DISTANCE_M = 20` (`lib/pin-audio.ts`) |
| 3 | heading 55° ბლოკავდა ხმას; დაბალ სიჩქარეზე GPS heading ხმაურია | audio-ზე 90° (`AUDIO_HEADING_TOLERANCE_DEG`), **მხოლოდ audio-სთვის** (`gps.ts`-ის default 55°, რასაც map/nav იყენებს, **არ შეცვლილა**); <1 მ/წმ-ზე heading შემოწმება გამოირთვება |
| 4,5 | strict sequence: თუ PIN გაიარა/GPS გამოტოვა, ის მუდმივად „next“ რჩებოდა და **შემდეგი ყველა PIN-ის ხმა იკარგებოდა** | catch-up (`decidePinAudio`): (a) *passed* — PIN-თან 40 მ-ში მივიდა და 8 მ-ით დაშორდა → ხმა ახლა ჩაირთვება; (b) *lookahead* — GPS გადახტა შემდეგ ≤2 PIN-ზე და მიზნის PIN ≤60 მ-ზე მართლა მიუახლოვდა → ახლანდელი PIN ჩაირთვება, გამოტოვებული ჩუმად „გავლილი“ ხდება (ძველ ინსტრუქციას არ ამბობს). `sort_order`/პირველი-untriggered წესი უცვლელია |
| 7 | `AudioContext` იქმნებოდა GPS callback-ში (gesture-ის გარეთ), `await ctx.resume()` შეიძლებოდა **სამუდამოდ დაკიდებულიყო**; suspended ctx-ზე მიბმული element კი **ჩუმად უხმოდ უკრავს** | `audioEngine.unlock()` (start ღილაკის click-ში სინქრონულად + პირველ pointer/touch/key-ზე — reload-ის შემდეგ resume-ისთვის); resume-ს 400 ms timeout; element არასდროს უკავშირდება არა-running ctx-ს (plain playback); **ერთი shared AudioContext** 25+ context-ის ნაცვლად (მობილურზე ლიმიტი აქვს). EQ ("mid" ტემბრი) იგივეა |
| 6,11 | Route 2–4 PIN-ებს `audio_url = null` აქვთ და `resolvePinAudioUrl` null-ს აბრუნებდა → MP3 არ იძებნებოდა (მხოლოდ TTS) | იგივე instruction→MP3 matcher ახლა ყველა route-ზე; route-1 უცვლელია; route 2–4-ზე თუ მხოლოდ ზოგადი „მინიშნება“ ემთხვევა → null (ზუსტი ტექსტი TTS-ით) |
| 8 | fallback TTS ორმაგად შეიძლებოდა გაეშვა (`onerror` + `catch`) | ერთ-ერთი გზა, ორმაგი TTS გამორიცხულია |
| 9 | დუბლირება | PIN ჯერ `triggered`-ში იწერება, მერე უკრავს; engine-ში `duplicate` სტატუსი |
| 10 | ჩავარდნის მიზეზი უცნობი იყო | `audioEngine.getDiagnostics()` + `console.warn('[AUDIO]', reason…)`: `autoplay-blocked`, `media-not-supported`, `media-error`, `play-rejected`, `no-audio-url`, `tts-unavailable`, `audio-context-not-running` |
| — | თუ MP3 **და** TTS ორივე ჩავარდა, PIN უხმოდ იკარგებოდა | `playDetailed()` აბრუნებს `failed` → მაქს. 3 ხელახალი მცდელობა |
| — | ორი PIN-ის ხმა ერთმანეთს ეჯახებოდა | `isBusy()` (12 წმ safety timeout) — დაკვრისას გადადებს, catch-up არ კარგავს |

## შეცვლილი / დამატებული ფაილები
- **შეცვლილი:** `src/lib/audio.ts`, `src/data/route-audio.ts`, `src/components/ExamDriveSession.tsx` (მხოლოდ audio-trigger ბლოკი, `unlock`, 2 ref, reset-ები)
- **შეცვლილი (ტესტის mock):** `ExamDriveSession.bug-exploration.test.tsx` — `@/lib/audio` mock-ს დაემატა `unlock`, `isBusy`, `playDetailed`. ⚠️ თუ სხვა ტესტებშიც mock-ავ `@/lib/audio`-ს, იქაც დაამატე ეს 3 მეთოდი.
- **ახალი:** `src/lib/pin-audio.ts`; ტესტები: `pin-audio.test.ts` (node:test), `audio.engine.test.tsx`, `route-audio.test.tsx`, `ExamDriveSession.pin-audio.test.tsx` (vitest)

## არ შეხებია
PIN კოორდინატები, `sort_order`, route data/JSON, GPS acquisition (`gps.ts`, `gps-filter`), map/arrow/navigation, Home/Return persistence, Finish logic, CSS/Responsive UI. MapLibre და `mapPane.style.transform` არ გამოყენებულა. ახალი dependency არ დამატებულა.

## შედეგები (დროებით აღდგენილ harness-ზე — იხ. ქვემოთ)
- `vite build`: ✅ 189 modules, built
- vitest (`test:run`): ✅ 28/28 (იყო 7; +21)
- node:test (`test:node`): ✅ 22/22 (იყო 9; +13)
- `tsc --noEmit`: ახალი შეცდომა არ დაემატა (ძველი 20 უცვლელია; ახალი `.test.ts` იგივე `node:test`-ტიპის გაფრთხილებას იძლევა, რასაც არსებული `gps-interpolation.test.ts`)

**Harness:** `package.json`/`vite.config`/`tsconfig` არქივში არ იყო; დროებითი ავაგე იმპორტებიდან (React 18, vitest 2, happy-dom, tsx). მასში გავუშვი build და ტესტები; შენს რეალურ კონფიგში ერთხელ გაუშვი `npm run build && npm run test:run && npm run test:node`.

## რისი შემოწმება ვერ მოხერხდა
რეალური მოწყობილობა/GPS/ბრაუზერი ვერ მქონდა. ტესტები ფარავს ლოგიკას, სიმულირებულ მგზავრობებს (3–70 მ/fix, GPS dropout-ები), engine-ს fake Audio/AudioContext-ით და კომპონენტის ჩართვას. Android-ზე რეალური გასინჯვა აუცილებელია (დევ რეჟიმში console-ში ჩანს `[PIN SEQUENCE] … Decision: in-range|passed|lookahead`).
iOS Safari-ზე element-level autoplay unlock სრულად არ არის მოდელირებული (გაკეთებულია ctx+TTS unlock).
