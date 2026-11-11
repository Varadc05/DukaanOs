# DukaanOS mobile (Flutter, Android)

**Status: written but not yet compiled.** The workspace this was built in has no Flutter SDK.
Expect to fix a few compile errors on first run (`flutter pub get`, then `flutter analyze`).

## First run

```bash
cd mobile
flutter create . --platforms=android      # generates android/ (not committed)
flutter pub get
flutter analyze
flutter test
flutter run \
  --dart-define=SUPABASE_URL=https://YOUR-PROJECT.supabase.co \
  --dart-define=SUPABASE_ANON_KEY=YOUR_ANON_KEY \
  --dart-define=API_URL=http://10.0.2.2:8080   # emulator -> your computer
```

Android permissions to add after `flutter create`: `CAMERA` (barcode) and `RECORD_AUDIO` (voice) in
`android/app/src/main/AndroidManifest.xml`, plus `INTERNET`.

## What is here

- `lib/data/local_db.dart`: SQLite catalogue cache and an outbox of bills waiting to sync.
- `lib/data/sync_service.dart`: pulls the catalogue, pushes the outbox with retry; one rejected bill never blocks the rest.
- `lib/features/billing/`: one cart for manual search, barcode scan (on-device) and voice.
- Bills are saved locally first, so billing and scanning work with no internet. Voice needs internet.
- The app only ever sends product ids and quantities. Prices, tax and stock come from the server.
