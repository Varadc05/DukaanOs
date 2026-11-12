import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:uuid/uuid.dart';

import '../../core/money.dart';
import '../../core/theme.dart';
import '../../data/api.dart';

/// Goods arrived: how much, what each unit cost, and (optionally) when it expires.
/// The request id is made once per screen, so tapping Save twice on a bad connection
/// cannot add the stock twice. Pops true when saved.
class ReceiveStockScreen extends StatefulWidget {
  const ReceiveStockScreen({super.key, required this.storeId, required this.product});
  final String storeId;
  final Map<String, dynamic> product;
  @override
  State<ReceiveStockScreen> createState() => _ReceiveStockScreenState();
}

class _ReceiveStockScreenState extends State<ReceiveStockScreen> {
  final _form = GlobalKey<FormState>();
  final _qty = TextEditingController();
  final _cost = TextEditingController();
  final String _requestId = const Uuid().v4();
  DateTime? _expiry;
  bool _busy = false;
  String? _error;

  String get _unit => widget.product['unit'] as String;

  @override
  void dispose() {
    _qty.dispose();
    _cost.dispose();
    super.dispose();
  }

  String _isoDate(DateTime d) =>
      '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

  Future<void> _pickExpiry() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: _expiry ?? now.add(const Duration(days: 90)),
      firstDate: now,
      lastDate: now.add(const Duration(days: 365 * 5)),
    );
    if (picked != null) setState(() => _expiry = picked);
  }

  Future<void> _save() async {
    if (!_form.currentState!.validate()) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await context.read<Api>().sendJson('POST', '/v1/stores/${widget.storeId}/stock/receive', {
        'id': _requestId,
        'product_id': widget.product['id'],
        'qty_milli': parseQtyMilli(_qty.text)!,
        'cost_paise': parseRupeesToPaise(_cost.text)!,
        'expiry_date': _expiry == null ? null : _isoDate(_expiry!),
      });
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Added ${formatQty(parseQtyMilli(_qty.text)!, _unit)}')));
        Navigator.of(context).pop(true);
      }
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
    final qty = parseQtyMilli(_qty.text);
    final cost = parseRupeesToPaise(_cost.text);
    return Scaffold(
      appBar: AppBar(title: const Text('Add stock')),
      body: Form(
        key: _form,
        child: ListView(padding: const EdgeInsets.fromLTRB(16, 8, 16, 32), children: [
          Text(widget.product['name'] as String, style: Theme.of(context).textTheme.headlineSmall),
          Text('Now in stock: ${formatQty(widget.product['qty_milli'] as int, _unit)}',
              style: const TextStyle(color: Palette.muted)),
          const SizedBox(height: 20),
          TextFormField(
            controller: _qty,
            autofocus: true,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            decoration: InputDecoration(labelText: 'How much arrived ($_unit)'),
            onChanged: (_) => setState(() {}),
            validator: (v) {
              final m = v == null ? null : parseQtyMilli(v);
              if (m == null) return 'Use numbers like 12 or 2.5';
              return m <= 0 ? 'Must be more than zero' : null;
            },
          ),
          const SizedBox(height: 14),
          TextFormField(
            controller: _cost,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            decoration: InputDecoration(labelText: 'You paid ₹ per $_unit', helperText: 'Used to work out how much cash is in stock'),
            onChanged: (_) => setState(() {}),
            validator: (v) => (v == null || parseRupeesToPaise(v) == null) ? 'Use numbers like 38 or 38.50' : null,
          ),
          if (qty != null && cost != null)
            Padding(
              padding: const EdgeInsets.only(top: 10),
              child: Text('Total paid: ${formatRupees(lineTotalPaise(cost, qty))}',
                  style: const TextStyle(fontWeight: FontWeight.w700, color: Palette.green)),
            ),
          const SizedBox(height: 14),
          SoftCard(
            padding: EdgeInsets.zero,
            child: ListTile(
              leading: const Icon(Icons.event_outlined),
              title: Text(_expiry == null ? 'Expiry date (optional)' : 'Expires ${_isoDate(_expiry!)}'),
              subtitle: const Text('Skip for things that do not expire'),
              trailing: _expiry == null
                  ? const Icon(Icons.chevron_right)
                  : IconButton(icon: const Icon(Icons.clear), tooltip: 'Remove date', onPressed: () => setState(() => _expiry = null)),
              onTap: _pickExpiry,
            ),
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
                : const Text('Add to stock'),
          ),
        ]),
      ),
    );
  }
}
