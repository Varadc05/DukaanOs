import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/money.dart';
import '../../data/api.dart';

/// Owner-only: low stock, expiry, dead stock and a budget-aware reorder list.
class InsightsScreen extends StatefulWidget {
  const InsightsScreen({super.key, required this.storeId});
  final String storeId;
  @override
  State<InsightsScreen> createState() => _InsightsScreenState();
}

class _InsightsScreenState extends State<InsightsScreen> {
  final _budget = TextEditingController();
  late Future<Map<String, dynamic>> _future = _load();

  Future<Map<String, dynamic>> _load() {
    final rupees = int.tryParse(_budget.text.trim());
    final query = rupees == null ? '' : '?budget_paise=${rupees * 100}';
    return context.read<Api>().getJson('/v1/stores/${widget.storeId}/insights$query');
  }

  Widget _section(String title, List<Widget> children) => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.only(top: 20, bottom: 4),
            child: Text(title, style: Theme.of(context).textTheme.titleMedium),
          ),
          if (children.isEmpty) const Text('Nothing to flag.') else ...children,
        ],
      );

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Stock insights')),
      body: FutureBuilder<Map<String, dynamic>>(
        future: _future,
        builder: (context, snap) {
          if (snap.connectionState != ConnectionState.done) {
            return const Center(child: CircularProgressIndicator());
          }
          final err = snap.error;
          if (err is ApiException && err.code == 'owner_only') {
            return const Center(child: Text('Only the owner can see this.'));
          }
          if (snap.hasError) {
            return const Center(child: Text('Could not load insights. Check your connection.'));
          }
          final d = snap.data!;
          List<Map<String, dynamic>> list(String k) => (d[k] as List).cast<Map<String, dynamic>>();
          final reorder = d['reorder'] as Map<String, dynamic>;
          final lines = (reorder['lines'] as List).cast<Map<String, dynamic>>();
          return ListView(padding: const EdgeInsets.all(16), children: [
            if ((d['history_days'] as int) < 28)
              const Card(
                child: Padding(
                  padding: EdgeInsets.all(12),
                  child: Text('Only a few days of sales so far, so forecasts are rough and will improve.'),
                ),
              ),
            _section('Running low', [
              for (final x in list('low_stock')) ListTile(dense: true, title: Text(x['name'] as String), subtitle: Text(x['reason'] as String)),
            ]),
            _section('Expiring soon', [
              for (final x in list('expiring'))
                ListTile(
                  dense: true,
                  title: Text(x['name'] as String),
                  subtitle: Text(x['expired'] as bool
                      ? 'Expired ${-(x['days_left'] as int)} days ago: ${formatQty(x['qty_milli'] as int, x['unit'] as String)}'
                      : '${x['days_left']} days left: ${formatQty(x['qty_milli'] as int, x['unit'] as String)}'),
                ),
            ]),
            _section('Cash tied up in dead stock: ${formatRupees(d['dead_stock_value_paise'] as int)}', [
              for (final x in list('dead_stock'))
                ListTile(
                  dense: true,
                  title: Text(x['name'] as String),
                  subtitle: Text('${x['days_idle']} days without a sale'),
                  trailing: Text(formatRupees(x['value_paise'] as int)),
                ),
            ]),
            _section('What to order', [
              Row(children: [
                Expanded(
                  child: TextField(
                    controller: _budget,
                    keyboardType: TextInputType.number,
                    decoration: const InputDecoration(labelText: 'Budget in rupees (optional)'),
                  ),
                ),
                TextButton(onPressed: () => setState(() => _future = _load()), child: const Text('Apply')),
              ]),
              for (final x in lines)
                ListTile(
                  dense: true,
                  title: Text('${x['name']}: ${formatQty(x['order_qty_milli'] as int, x['unit'] as String)}'),
                  subtitle: Text(x['reason'] as String),
                  trailing: Text(formatRupees(x['est_cost_paise'] as int)),
                ),
              if (lines.isNotEmpty) Text('Total ${formatRupees(reorder['total_paise'] as int)}', style: Theme.of(context).textTheme.titleSmall),
            ]),
          ]);
        },
      ),
    );
  }
}
