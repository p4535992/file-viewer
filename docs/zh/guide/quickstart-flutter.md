# Flutter 快速开始

[File Viewer Flutter](https://flutter.file-viewer.app) 是独立维护的 Flutter 组件，提供应用级预热、会话复用和随包分发的离线资源。当前 pub.dev 版本为 `0.1.0-dev.2` 开发预览，客户无需 Node.js 或 JavaScript 源码构建。

## 1. 安装并配置

使用 Flutter 3.47+ / Dart 3.13+，在应用 `pubspec.yaml` 中添加：

```yaml
dependencies:
  file_viewer_flutter: 0.1.0-dev.2
```

```sh
flutter pub get
dart run file_viewer_flutter:setup --project . --check
dart run file_viewer_flutter:setup --project . --apply
```

在应用根目录执行。`--check` 展示宿主配置差异，`--apply` 才写入；Web 无需原生宿主修改。完成后完整重建应用。

## 2. 添加文件并显示

将 PDF 放入 `assets/example.pdf`，在同一个 `pubspec.yaml` 中声明：

```yaml
flutter:
  assets:
    - assets/example.pdf
```

应用入口：

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

`FileViewerHost` 在首帧后启动预热，`Scaffold.body` 提供有界布局。其他布局中请使用明确尺寸或 `Expanded`。

macOS 已通过 Apple Silicon 与 Intel 双架构实机验证，覆盖 PPTX/Excel 视图适配与会话复用。具体系统与检查范围见[兼容性矩阵](https://github.com/flyfish-dev/file-viewer-flutter/blob/main/docs/qualification.md)。

## 继续阅读

- [Flutter 完整接入文档](https://flutter.file-viewer.app/zh/docs/quickstart/)：六端配置、文件来源、控制器、预热复用与离线部署。
- [pub.dev 软件包](https://pub.dev/packages/file_viewer_flutter) 与 [Flutter 独立仓库](https://github.com/flyfish-dev/file-viewer-flutter)。

目标平台包括 Android、iOS、Web、Windows、macOS 与 Linux；实际设备、系统和格式范围以 Flutter 站点的兼容说明为准。后台期间在系统允许时保留实例，不承诺永久后台运行或所有设备均已验收。
