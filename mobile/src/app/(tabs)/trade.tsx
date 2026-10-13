import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
  Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { PriestTheme } from '../../constants/theme';
import { Header } from '../../components/Header';
import { CandleChart } from '../../components/CandleChart';
import { OrderBook } from '../../components/OrderBook';
import { TradePanel } from '../../components/TradePanel';
import { PositionCard } from '../../components/PositionCard';
import { PnLShareModal } from '../../components/PnLShareModal';
import { usePriest } from '../../hooks/usePriestState';
import type { PositionItem, MarketItem } from '../../lib/types';

type TerminalSubTab = 'trade' | 'positions' | 'orderbook' | 'orders';

export default function TradeScreen() {
  const {
    markets,
    selectedMarket,
    setSelectedMarket,
    positions,
    openOrders,
    cancelOrder,
    activePnlShare,
    setActivePnlShare,
  } = usePriest();

  const [activeTab, setActiveTab] = useState<TerminalSubTab>('trade');
  const [selectedOrderBookPrice, setSelectedOrderBookPrice] = useState<number | null>(null);
  const [marketPickerVisible, setMarketPickerVisible] = useState(false);

  const marketPositions = positions.filter((p) => p.mint === selectedMarket.mint);

  const handleSelectMarket = (m: MarketItem) => {
    Haptics.selectionAsync();
    setSelectedMarket(m);
    setMarketPickerVisible(false);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <Header />

      {/* Market Selector & Ticker Bar */}
      <View style={styles.tickerBar}>
        <TouchableOpacity
          style={styles.marketSelector}
          onPress={() => setMarketPickerVisible(true)}
          activeOpacity={0.8}
        >
          <View>
            <View style={styles.symbolRow}>
              <Text style={styles.symbol}>{selectedMarket.symbol}</Text>
              <Ionicons name="chevron-down" size={16} color={PriestTheme.colors.textMuted} />
            </View>
            <Text style={styles.marketEngine}>{selectedMarket.engine} Engine</Text>
          </View>
        </TouchableOpacity>

        <View style={styles.tickerMetrics}>
          <View style={styles.tickerMetric}>
            <Text style={styles.metricLabel}>Price</Text>
            <Text style={styles.metricPrice}>
              ${selectedMarket.price < 0.01 ? selectedMarket.price.toFixed(5) : selectedMarket.price.toFixed(4)}
            </Text>
          </View>
          <View style={styles.tickerMetric}>
            <Text style={styles.metricLabel}>24h Change</Text>
            <Text
              style={[
                styles.metricChange,
                { color: selectedMarket.priceChange24h >= 0 ? PriestTheme.colors.primary : PriestTheme.colors.danger },
              ]}
            >
              {selectedMarket.priceChange24h >= 0 ? '+' : ''}
              {selectedMarket.priceChange24h.toFixed(2)}%
            </Text>
          </View>
          <View style={styles.tickerMetric}>
            <Text style={styles.metricLabel}>Funding (30m)</Text>
            <Text style={styles.metricFunding}>
              {(selectedMarket.fundingRate * 100).toFixed(3)}%
            </Text>
          </View>
        </View>
      </View>

      {/* Sub Tabs: Trade / Positions / OrderBook / Orders */}
      <View style={styles.tabNav}>
        <TouchableOpacity
          style={[styles.tabItem, activeTab === 'trade' && styles.tabItemActive]}
          onPress={() => {
            Haptics.selectionAsync();
            setActiveTab('trade');
          }}
        >
          <Text style={[styles.tabText, activeTab === 'trade' && styles.tabTextActive]}>
            Trade
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tabItem, activeTab === 'orderbook' && styles.tabItemActive]}
          onPress={() => {
            Haptics.selectionAsync();
            setActiveTab('orderbook');
          }}
        >
          <Text style={[styles.tabText, activeTab === 'orderbook' && styles.tabTextActive]}>
            Order Book
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tabItem, activeTab === 'positions' && styles.tabItemActive]}
          onPress={() => {
            Haptics.selectionAsync();
            setActiveTab('positions');
          }}
        >
          <View style={styles.tabBadgeRow}>
            <Text style={[styles.tabText, activeTab === 'positions' && styles.tabTextActive]}>
              Positions
            </Text>
            {positions.length > 0 && (
              <View style={styles.posBadge}>
                <Text style={styles.posBadgeText}>{positions.length}</Text>
              </View>
            )}
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tabItem, activeTab === 'orders' && styles.tabItemActive]}
          onPress={() => {
            Haptics.selectionAsync();
            setActiveTab('orders');
          }}
        >
          <View style={styles.tabBadgeRow}>
            <Text style={[styles.tabText, activeTab === 'orders' && styles.tabTextActive]}>
              Orders
            </Text>
            {openOrders.length > 0 && (
              <View style={styles.ordersBadge}>
                <Text style={styles.ordersBadgeText}>{openOrders.length}</Text>
              </View>
            )}
          </View>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}
      >
        {/* Interactive Price Chart */}
        <CandleChart
          basePrice={selectedMarket.price}
          symbol={selectedMarket.symbol}
          mint={selectedMarket.mint}
        />

        {/* Tab Content Rendering */}
        {activeTab === 'trade' && (
          <TradePanel
            market={selectedMarket}
            overridePrice={selectedOrderBookPrice}
          />
        )}

        {activeTab === 'orderbook' && (
          <OrderBook
            midPrice={selectedMarket.price}
            mint={selectedMarket.mint}
            onSelectPrice={(p) => {
              setSelectedOrderBookPrice(p);
              setActiveTab('trade');
            }}
          />
        )}

        {activeTab === 'positions' && (
          <View style={styles.positionsSection}>
            <Text style={styles.sectionTitle}>
              Active Positions ({positions.length})
            </Text>
            {positions.length === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons name="layers-outline" size={32} color={PriestTheme.colors.textMuted} />
                <Text style={styles.emptyTitle}>No open positions</Text>
                <Text style={styles.emptySubtitle}>
                  Open a Long or Short to leverage market moves.
                </Text>
              </View>
            ) : (
              positions.map((pos) => (
                <PositionCard
                  key={pos.id}
                  position={pos}
                  onSharePnl={(p) => setActivePnlShare(p)}
                />
              ))
            )}
          </View>
        )}

        {activeTab === 'orders' && (
          <View style={styles.ordersSection}>
            <Text style={styles.sectionTitle}>
              Open Limit Orders ({openOrders.length})
            </Text>
            {openOrders.length === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons name="document-text-outline" size={32} color={PriestTheme.colors.textMuted} />
                <Text style={styles.emptyTitle}>No open limit orders</Text>
                <Text style={styles.emptySubtitle}>
                  Resting orders will appear here before execution.
                </Text>
              </View>
            ) : (
              openOrders.map((ord) => (
                <View key={ord.id} style={styles.orderCard}>
                  <View style={styles.orderTop}>
                    <Text style={styles.orderSymbol}>{ord.symbol}</Text>
                    <View
                      style={[
                        styles.orderSideBadge,
                        ord.side === 'Long' ? styles.orderSideLong : styles.orderSideShort,
                      ]}
                    >
                      <Text
                        style={[
                          styles.orderSideText,
                          ord.side === 'Long' ? styles.orderSideTextLong : styles.orderSideTextShort,
                        ]}
                      >
                        {ord.side} {ord.leverage}x
                      </Text>
                    </View>
                  </View>
                  <View style={styles.orderDetailRow}>
                    <Text style={styles.orderDetailLabel}>Target Price:</Text>
                    <Text style={styles.orderDetailValue}>${ord.price.toFixed(4)}</Text>
                  </View>
                  <View style={styles.orderDetailRow}>
                    <Text style={styles.orderDetailLabel}>Size:</Text>
                    <Text style={styles.orderDetailValue}>{ord.size.toLocaleString()}</Text>
                  </View>
                  <TouchableOpacity
                    style={styles.cancelBtn}
                    onPress={() => cancelOrder(ord.id)}
                  >
                    <Text style={styles.cancelBtnText}>Cancel Order</Text>
                  </TouchableOpacity>
                </View>
              ))
            )}
          </View>
        )}
      </ScrollView>

      {/* Market Picker Modal */}
      <Modal
        visible={marketPickerVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setMarketPickerVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <SafeAreaView style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select Market</Text>
              <TouchableOpacity onPress={() => setMarketPickerVisible(false)}>
                <Ionicons name="close" size={20} color={PriestTheme.colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.modalList}>
              {markets.map((m) => (
                <TouchableOpacity
                  key={m.mint}
                  style={[
                    styles.marketOption,
                    selectedMarket.mint === m.mint && styles.marketOptionSelected,
                  ]}
                  onPress={() => handleSelectMarket(m)}
                >
                  <View>
                    <View style={styles.modalSymbolRow}>
                      <Text style={styles.modalSymbol}>{m.symbol}</Text>
                      <Text style={styles.modalEngineBadge}>{m.engine}</Text>
                    </View>
                    <Text style={styles.modalName}>{m.name}</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={styles.modalPrice}>${m.price.toFixed(4)}</Text>
                    <Text
                      style={[
                        styles.modalChange,
                        { color: m.priceChange24h >= 0 ? PriestTheme.colors.primary : PriestTheme.colors.danger },
                      ]}
                    >
                      {m.priceChange24h >= 0 ? '+' : ''}{m.priceChange24h.toFixed(2)}%
                    </Text>
                  </View>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </SafeAreaView>
        </View>
      </Modal>

      {/* PnL Card Sharing Modal */}
      <PnLShareModal
        position={activePnlShare}
        onClose={() => setActivePnlShare(null)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: PriestTheme.colors.bg0,
  },
  container: {
    flex: 1,
    backgroundColor: PriestTheme.colors.bg0,
  },
  contentContainer: {
    padding: 16,
    paddingBottom: 40,
  },
  tickerBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: PriestTheme.colors.bg1,
    borderBottomWidth: 1,
    borderBottomColor: PriestTheme.colors.borderSubtle,
  },
  marketSelector: {
    paddingRight: 10,
  },
  symbolRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  symbol: {
    color: PriestTheme.colors.textPrimary,
    fontSize: 18,
    fontWeight: '900',
  },
  marketEngine: {
    color: PriestTheme.colors.primary,
    fontSize: 10,
    fontWeight: '700',
  },
  tickerMetrics: {
    flexDirection: 'row',
    gap: 14,
  },
  tickerMetric: {
    alignItems: 'flex-end',
  },
  metricLabel: {
    color: PriestTheme.colors.textMuted,
    fontSize: 9,
    fontWeight: '600',
  },
  metricPrice: {
    color: PriestTheme.colors.textPrimary,
    fontSize: 13,
    fontWeight: '800',
    marginTop: 1,
  },
  metricChange: {
    fontSize: 12,
    fontWeight: '700',
    marginTop: 1,
  },
  metricFunding: {
    color: PriestTheme.colors.primary,
    fontSize: 12,
    fontWeight: '700',
    marginTop: 1,
  },
  tabNav: {
    flexDirection: 'row',
    backgroundColor: PriestTheme.colors.bg1,
    borderBottomWidth: 1,
    borderBottomColor: PriestTheme.colors.borderSubtle,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabItemActive: {
    borderBottomColor: PriestTheme.colors.primary,
  },
  tabText: {
    color: PriestTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
  },
  tabTextActive: {
    color: PriestTheme.colors.primary,
  },
  tabBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  posBadge: {
    backgroundColor: PriestTheme.colors.primaryDim,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 8,
  },
  posBadgeText: {
    color: PriestTheme.colors.primary,
    fontSize: 10,
    fontWeight: '900',
  },
  ordersBadge: {
    backgroundColor: PriestTheme.colors.bg4,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 8,
  },
  ordersBadgeText: {
    color: PriestTheme.colors.textPrimary,
    fontSize: 10,
    fontWeight: '800',
  },
  positionsSection: {
    marginBottom: 20,
  },
  ordersSection: {
    marginBottom: 20,
  },
  sectionTitle: {
    color: PriestTheme.colors.textPrimary,
    fontSize: 15,
    fontWeight: '800',
    marginBottom: 12,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 32,
    backgroundColor: PriestTheme.colors.bg2,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: PriestTheme.colors.border,
  },
  emptyTitle: {
    color: PriestTheme.colors.textPrimary,
    fontSize: 15,
    fontWeight: '700',
    marginTop: 8,
  },
  emptySubtitle: {
    color: PriestTheme.colors.textMuted,
    fontSize: 12,
    marginTop: 4,
  },
  orderCard: {
    backgroundColor: PriestTheme.colors.bg2,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: PriestTheme.colors.border,
    marginBottom: 10,
  },
  orderTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  orderSymbol: {
    color: PriestTheme.colors.textPrimary,
    fontSize: 16,
    fontWeight: '800',
  },
  orderSideBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  orderSideLong: {
    backgroundColor: PriestTheme.colors.primaryDim,
  },
  orderSideShort: {
    backgroundColor: PriestTheme.colors.dangerDim,
  },
  orderSideText: {
    fontSize: 11,
    fontWeight: '800',
  },
  orderSideTextLong: {
    color: PriestTheme.colors.primary,
  },
  orderSideTextShort: {
    color: PriestTheme.colors.danger,
  },
  orderDetailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 3,
  },
  orderDetailLabel: {
    color: PriestTheme.colors.textMuted,
    fontSize: 12,
  },
  orderDetailValue: {
    color: PriestTheme.colors.textPrimary,
    fontSize: 12,
    fontWeight: '700',
  },
  cancelBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  cancelBtnText: {
    color: PriestTheme.colors.danger,
    fontSize: 12,
    fontWeight: '700',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: PriestTheme.colors.bg1,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 18,
    borderBottomWidth: 1,
    borderBottomColor: PriestTheme.colors.borderSubtle,
  },
  modalTitle: {
    color: PriestTheme.colors.textPrimary,
    fontSize: 17,
    fontWeight: '800',
  },
  modalList: {
    padding: 16,
  },
  marketOption: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 14,
    backgroundColor: PriestTheme.colors.bg2,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: PriestTheme.colors.border,
    marginBottom: 8,
  },
  marketOptionSelected: {
    borderColor: PriestTheme.colors.primary,
    backgroundColor: PriestTheme.colors.primaryDim,
  },
  modalSymbolRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  modalSymbol: {
    color: PriestTheme.colors.textPrimary,
    fontSize: 16,
    fontWeight: '800',
  },
  modalEngineBadge: {
    color: PriestTheme.colors.primary,
    fontSize: 10,
    fontWeight: '700',
  },
  modalName: {
    color: PriestTheme.colors.textSecondary,
    fontSize: 12,
    marginTop: 2,
  },
  modalPrice: {
    color: PriestTheme.colors.textPrimary,
    fontSize: 15,
    fontWeight: '800',
  },
  modalChange: {
    fontSize: 12,
    fontWeight: '700',
    marginTop: 2,
  },
});
