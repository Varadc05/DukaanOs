import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:uuid/uuid.dart';

import '../../core/money.dart';
import '../../core/theme.dart';
import '../../data/api.dart';

const _reasons = {
  'adjust': 'Count correction',
  'damage': 'Damaged or spoiled',
  'expired': 'Expired',
};

/// Physical count: type what is really on the shelf and the app records the difference.
/// Pops true when saved.
class AdjustStockScreen extends StatefulWidget {
  const AdjustStockScreen({super.key, required this.storeId, required this.product});
  final String storeId;
  final Map<String, dynamic> product;
  @override
  State<AdjustStockScreen> createState() => _AdjustStockScreenState();
}

class _AdjustStockScreenState extends State<AdjustStockScreen> {
  final _form = GlobalKey<FormState>();
  final _counted = TextEditingController();
  final String _requestId = const Uuid().v4();
  String _reason = 'adjust';
  bool _busy = false;
  String? _error;

  String get _unit => widget.product['unit'] as String;
  int get _system => widget.product['qty_milli'] as int;

  @override
  void dispose() {
    _counted.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (!_form.currentState!.validate()) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final res = await context.read<Api>().sendJson('POST', '/v1/stores/${widget.storeId}/stock/adjust', {
        'id': _requestId,
        'product_id': widget.product['id'],
        'counted_milli': parseQtyMilli(_counted.text)!,
        'reason': _reason,
      });
      if (!mounted) return;
      final applied = res['applied'] == true;
      ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(applied ? 'Stock updated' : 'Your count already matches. Nothing changed.')));
      Navigator.of(context).pop(applied);
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } catch (_) {
      setState(() => _error = 'Could not reach the server. Check your connection and try again. Tapping Save again is safe.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final counted = parseQtyMilli(_counted.text);
    final diff = counted == null ? null : counted - _system;
    return Scaffold(
      appBar: AppBar(title: const Text('Count stock')),
      body: Form(
        key: _form,
        child: ListView(padding: const EdgeInsets.fromLTRB(16, 8, 16, 32), children: [
          Text(widget.product['name'] as String, style: Theme.of(context).textTheme.headlineSmall),
          const SizedBox(height: 4),
          Text('The app shows ${formatQty(_system, _unit)}', style: const TextStyle(color: Palette.muted, fontSize: 16)),
          const SizedBox(height: 20),
          TextFormField(
            controller: _counted,
            autofocus: true,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            decoration: InputDecoration(labelText: 'How much is really on the shelf ($_unit)'),
            onChanged: (_) => setState(() {}),
            validator: (v) => (v == null || parseQtyMilli(v) == null) ? 'Use numbers like 12 or 2.5. Type 0 if none.' : null,
          ),
          if (diff != null)
            Padding(
              padding: const EdgeInsets.only(top: 12),
              child: Text(
                diff == 0
                    ? 'Matches the app.'
                    : diff > 0
                        ? 'This adds ${formatQty(diff, _unit)}.'
                        : 'This removes ${formatQty(-diff, _unit)}.',
                style: TextStyle(fontWeight: FontWeight.w700, color: diff < 0 ? Palette.red : Palette.green, fontSize: 16),
              ),
            ),
          const SizedBox(height: 14),
          DropdownButtonFormField<String>(
            value: _reason,
            decoration: const InputDecoration(labelText: 'Why'),
            items: [for (final e in _reasons.entries) DropdownMenuItem(value: e.key, child: Text(e.value))],
            onChanged: (v) => setState(() => _reason = v ?? _reason),
          ),
          if (_reason != 'adjust' && diff != null && diff > 0)
            const Padding(
              padding: EdgeInsets.only(top: 10),
              child: Text('Damaged or expired stock can only lower the count. Choose "Count correction" to add stock.',
                  style: TextStyle(color: Palette.red)),
            ),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.only(top: 16),
              child: Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error, fontWeight: FontWeight.w600)),
            ),
          const SizedBox(height: 24),
          FilledButton(
            onPressed: _busy ? null : _save,
            child: _busy
                ? const SizedBox(height: 22, width: 22, child: CircularProgressIndicator(strokeWidth: 3, color: Colors.white))
                : const Text('Save count'),
          ),
        ]),
      ),
    );
  }
}
