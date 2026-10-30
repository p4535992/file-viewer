# Flutter quick start

[File Viewer Flutter](https://flutter.file-viewer.app/en/) is an independently maintained Flutter component with application-scoped warm-up, reusable sessions and bundled offline resources. The pub.dev release is development preview `0.1.0-dev.2`. Customer applications need no Node.js or JavaScript source build.

## 1. Install and configure

Use Flutter 3.47+ / Dart 3.13+. Add to your application's `pubspec.yaml`:

```yaml
dependencies:
  file_viewer_flutter: 0.1.0-dev.2
```

```sh
flutter pub get
dart run file_viewer_flutter:setup --project . --check
dart run file_viewer_flutter:setup --project . --apply
```

Run from the application root. `--check` previews host changes; only `--apply` writes them. Web needs no native host changes. Fully rebuild the application afterward.

## 2. Add and display a document

Place a PDF at `assets/example.pdf` and declare it in the same `pubspec.yaml`:

```yaml
flutter:
  assets:
    - assets/example.pdf
```

Application entry:

```dart
import 'package:flutter/material.dart';
import 'package:file_viewer_flutter/file_viewer_flutter.dart';

void main() {
  runApp(const FileViewerHost(
    child: MaterialApp(
      home: Scaffold(
        body: FileViewer(
          source: FileViewerSource.asset('assets/example.pdf'),
        ),
      ),
    ),
  ));
}
```

`FileViewerHost` warms up after the first frame and `Scaffold.body` provides bounded layout. Use an explicit size or `Expanded` in other layouts.

macOS has passed native validation on both Apple Silicon and Intel devices, including PPTX/Excel viewport fitting and retained-session reuse. Exact systems and checks are recorded in the [qualification matrix](https://github.com/flyfish-dev/file-viewer-flutter/blob/main/docs/qualification.md).

## Continue reading

- [Complete Flutter documentation](https://flutter.file-viewer.app/en/docs/quickstart/): platform setup, sources, controllers, session reuse and offline delivery.
- [pub.dev package](https://pub.dev/packages/file_viewer_flutter) and [independent Flutter repository](https://github.com/flyfish-dev/file-viewer-flutter).

Targets include Android, iOS, Web, Windows, macOS and Linux. Consult the Flutter site's qualification notes for measured device, OS and format scope. Background retention remains subject to OS suspension and reclamation; perpetual background operation and universal device qualification are not promised.
