import 'package:flutter/material.dart';

/// Colours from design/README.md: cream background, deep green primary, turmeric accent.
class Palette {
  static const cream = Color(0xFFFBF6EC);
  static const green = Color(0xFF0F5B3E);
  static const greenTint = Color(0xFFE4F0E8);
  static const turmeric = Color(0xFFE8A317);
  static const turmericTint = Color(0xFFFBEBC4);
  static const ink = Color(0xFF1F2A24);
  static const muted = Color(0xFF5C655F);
  static const border = Color(0xFFE6DCC8);
  static const red = Color(0xFFB3331D);
  static const redTint = Color(0xFFF8E1DB);
}

ThemeData dukaanTheme() {
  final scheme = ColorScheme.fromSeed(
    seedColor: Palette.green,
    primary: Palette.green,
    secondary: Palette.turmeric,
    surface: Palette.cream,
    error: Palette.red,
  );
  return ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    scaffoldBackgroundColor: Palette.cream,
    appBarTheme: const AppBarTheme(
      backgroundColor: Palette.cream,
      foregroundColor: Palette.green,
      elevation: 0,
      titleTextStyle: TextStyle(color: Palette.green, fontSize: 22, fontWeight: FontWeight.w700),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: Colors.white,
      border: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: const BorderSide(color: Palette.border, width: 1.5)),
      enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: const BorderSide(color: Palette.border, width: 1.5)),
      focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: const BorderSide(color: Palette.green, width: 2)),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        minimumSize: const Size.fromHeight(56),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        textStyle: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
      ),
    ),
  );
}

/// White rounded card with the design's warm border. Used instead of ThemeData.cardTheme,
/// whose type changed between Flutter versions.
class SoftCard extends StatelessWidget {
  const SoftCard({super.key, required this.child, this.padding = const EdgeInsets.all(16)});
  final Widget child;
  final EdgeInsetsGeometry padding;
  @override
  Widget build(BuildContext context) => Container(
        padding: padding,
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(18),
          border: Border.all(color: Palette.border, width: 1.5),
        ),
        child: child,
      );
}
