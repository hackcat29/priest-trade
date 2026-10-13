import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  SafeAreaView,
  RefreshControl,
  Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { PriestTheme } from '../../constants/theme';
import { Header } from '../../components/Header';
import { PnLShareModal } from '../../components/PnLShareModal';
import { usePriest } from '../../hooks/usePriestState';
import { INITIAL_POSTS, getStoredPosts, saveStoredPosts, fetchLiveFeed } from '../../lib/api';
import type { FeedPostItem, PositionItem } from '../../lib/types';

export default function FeedScreen() {
  const { positions } = usePriest();
  const [posts, setPosts] = useState<FeedPostItem[]>(INITIAL_POSTS);
  const [refreshing, setRefreshing] = useState(false);
  const [composerVisible, setComposerVisible] = useState(false);
  const [newPostBody, setNewPostBody] = useState('');
  const [newPostSentiment, setNewPostSentiment] = useState<'bullish' | 'bearish' | 'neutral'>('bullish');
  const [selectedPosToAttach, setSelectedPosToAttach] = useState<PositionItem | null>(null);
  const [activeSharePos, setActiveSharePos] = useState<PositionItem | null>(null);

  useEffect(() => {
    fetchLiveFeed().then((live) => {
      if (live && live.length > 0) {
        setPosts(live);
      }
    });
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const live = await fetchLiveFeed();
      if (live && live.length > 0) {
        setPosts(live);
      }
    } finally {
      setRefreshing(false);
    }
  };

  const handleLike = (postId: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setPosts((prev) =>
      prev.map((p) => {
        if (p.id === postId) {
          const isLiked = !p.isLiked;
          return {
            ...p,
            isLiked,
            likes: isLiked ? p.likes + 1 : p.likes - 1,
          };
        }
        return p;
      })
    );
  };

  const handleCreatePost = () => {
    if (!newPostBody.trim()) return;

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const newPost: FeedPostItem = {
      id: `post-${Date.now()}`,
      authorHandle: 'you',
      authorName: 'Anon Trader',
      timestamp: 'Just now',
      body: newPostBody,
      sentiment: newPostSentiment,
      likes: 0,
      comments: 0,
      pnlCard: selectedPosToAttach
        ? {
            symbol: selectedPosToAttach.symbol,
            side: selectedPosToAttach.side,
            roePercent: selectedPosToAttach.roePercent,
            pnlUsd: selectedPosToAttach.pnlUsd,
            entryPrice: selectedPosToAttach.entryPrice,
            markPrice: selectedPosToAttach.markPrice,
            leverage: selectedPosToAttach.leverage,
            skin: 'cyberpunk',
          }
        : undefined,
    };

    const updated = [newPost, ...posts];
    setPosts(updated);
    saveStoredPosts(updated);
    setNewPostBody('');
    setSelectedPosToAttach(null);
    setComposerVisible(false);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <Header title="Social Trading Feed" />

      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={PriestTheme.colors.primary}
          />
        }
      >
        {/* Quick Compose Banner */}
        <TouchableOpacity
          style={styles.composeTrigger}
          onPress={() => setComposerVisible(true)}
          activeOpacity={0.8}
        >
          <View style={styles.myAvatar}>
            <Text style={styles.myAvatarText}>U</Text>
          </View>
          <Text style={styles.composePlaceholder}>
            Share alpha, post your trade, or flex PnL...
          </Text>
          <Ionicons name="create-outline" size={20} color={PriestTheme.colors.primary} />
        </TouchableOpacity>

        {/* Posts List */}
        {posts.map((post) => {
          const isBullish = post.sentiment === 'bullish';
          const isBearish = post.sentiment === 'bearish';

          return (
            <View key={post.id} style={styles.postCard}>
              {/* Post Header */}
              <View style={styles.postHeader}>
                <View style={styles.authorRow}>
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>{post.authorName[0]}</Text>
                  </View>
                  <View>
                    <View style={styles.nameRow}>
                      <Text style={styles.authorName}>{post.authorName}</Text>
                      {post.badge && (
                        <View style={styles.badgePill}>
                          <Text style={styles.badgeText}>{post.badge}</Text>
                        </View>
                      )}
                    </View>
                    <Text style={styles.authorHandle}>
                      @{post.authorHandle} • {post.timestamp}
                    </Text>
                  </View>
                </View>

                {/* Sentiment Pill */}
                {post.sentiment && post.sentiment !== 'neutral' && (
                  <View
                    style={[
                      styles.sentimentPill,
                      isBullish ? styles.sentimentBullish : styles.sentimentBearish,
                    ]}
                  >
                    <Ionicons
                      name={isBullish ? 'trending-up' : 'trending-down'}
                      size={12}
                      color={isBullish ? PriestTheme.colors.primary : PriestTheme.colors.danger}
                    />
                    <Text
                      style={[
                        styles.sentimentText,
                        isBullish ? styles.sentimentTextBullish : styles.sentimentTextBearish,
                      ]}
                    >
                      {post.sentiment.toUpperCase()}
                    </Text>
                  </View>
                )}
              </View>

              {/* Body */}
              <Text style={styles.postBody}>{post.body}</Text>

              {/* Embedded PnL Card (if present) */}
              {post.pnlCard && (
                <View style={styles.embeddedPnl}>
                  <View style={styles.pnlCardTop}>
                    <View style={styles.pnlCardSymbolRow}>
                      <Text style={styles.pnlCardSymbol}>${post.pnlCard.symbol}</Text>
                      <View
                        style={[
                          styles.pnlSideBadge,
                          post.pnlCard.side === 'Long'
                            ? styles.pnlSideBadgeLong
                            : styles.pnlSideBadgeShort,
                        ]}
                      >
                        <Text
                          style={[
                            styles.pnlSideText,
                            post.pnlCard.side === 'Long'
                              ? styles.pnlSideTextLong
                              : styles.pnlSideTextShort,
                          ]}
                        >
                          {post.pnlCard.side} {post.pnlCard.leverage}x
                        </Text>
                      </View>
                    </View>
                    <Text
                      style={[
                        styles.pnlRoe,
                        {
                          color:
                            post.pnlCard.roePercent >= 0
                              ? PriestTheme.colors.primary
                              : PriestTheme.colors.danger,
                        },
                      ]}
                    >
                      {post.pnlCard.roePercent >= 0 ? '+' : ''}
                      {post.pnlCard.roePercent.toFixed(1)}% ROE
                    </Text>
                  </View>

                  <View style={styles.pnlDetailsRow}>
                    <Text style={styles.pnlDetailLabel}>
                      Entry: ${post.pnlCard.entryPrice.toFixed(4)}
                    </Text>
                    <Text style={styles.pnlDetailLabel}>
                      Mark: ${post.pnlCard.markPrice.toFixed(4)}
                    </Text>
                    <Text
                      style={[
                        styles.pnlDetailLabel,
                        {
                          color:
                            post.pnlCard.pnlUsd >= 0
                              ? PriestTheme.colors.primary
                              : PriestTheme.colors.danger,
                          fontWeight: '700',
                        },
                      ]}
                    >
                      {post.pnlCard.pnlUsd >= 0 ? '+' : ''}${post.pnlCard.pnlUsd.toFixed(2)}
                    </Text>
                  </View>
                </View>
              )}

              {/* Post Footer Actions */}
              <View style={styles.postFooter}>
                <TouchableOpacity
                  style={styles.footerAction}
                  onPress={() => handleLike(post.id)}
                >
                  <Ionicons
                    name={post.isLiked ? 'heart' : 'heart-outline'}
                    size={16}
                    color={post.isLiked ? PriestTheme.colors.danger : PriestTheme.colors.textMuted}
                  />
                  <Text
                    style={[
                      styles.actionCount,
                      post.isLiked && { color: PriestTheme.colors.danger },
                    ]}
                  >
                    {post.likes}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.footerAction}>
                  <Ionicons name="chatbubble-outline" size={15} color={PriestTheme.colors.textMuted} />
                  <Text style={styles.actionCount}>{post.comments}</Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.footerAction}>
                  <Ionicons name="repeat-outline" size={17} color={PriestTheme.colors.textMuted} />
                  <Text style={styles.actionCount}>Share</Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        })}
      </ScrollView>

      {/* Post Composer Modal */}
      <Modal visible={composerVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <SafeAreaView style={styles.composerSheet}>
            <View style={styles.composerHeader}>
              <Text style={styles.composerTitle}>New Post</Text>
              <TouchableOpacity onPress={() => setComposerVisible(false)}>
                <Ionicons name="close" size={22} color={PriestTheme.colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <TextInput
              style={styles.composerInput}
              multiline
              placeholder="What's happening in the markets?"
              placeholderTextColor={PriestTheme.colors.textMuted}
              value={newPostBody}
              onChangeText={setNewPostBody}
              autoFocus
            />

            {/* Sentiment Selector */}
            <View style={styles.sentimentSelector}>
              <Text style={styles.selectorLabel}>Sentiment:</Text>
              {(['bullish', 'bearish', 'neutral'] as const).map((s) => (
                <TouchableOpacity
                  key={s}
                  style={[
                    styles.sentimentOption,
                    newPostSentiment === s && styles.sentimentOptionActive,
                  ]}
                  onPress={() => setNewPostSentiment(s)}
                >
                  <Text
                    style={[
                      styles.sentimentOptionText,
                      newPostSentiment === s && styles.sentimentOptionTextActive,
                    ]}
                  >
                    {s.toUpperCase()}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Attach Trade Position if available */}
            {positions.length > 0 && (
              <View style={styles.attachSection}>
                <Text style={styles.selectorLabel}>Attach Active Position:</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 6 }}>
                  {positions.map((pos) => (
                    <TouchableOpacity
                      key={pos.id}
                      style={[
                        styles.attachPill,
                        selectedPosToAttach?.id === pos.id && styles.attachPillActive,
                      ]}
                      onPress={() =>
                        setSelectedPosToAttach(selectedPosToAttach?.id === pos.id ? null : pos)
                      }
                    >
                      <Text style={styles.attachPillText}>
                        ${pos.symbol} {pos.side} ({pos.roePercent.toFixed(1)}%)
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            )}

            {/* Submit Post Button */}
            <TouchableOpacity
              style={styles.postSubmitBtn}
              onPress={handleCreatePost}
              activeOpacity={0.8}
            >
              <Text style={styles.postSubmitText}>Publish Post</Text>
            </TouchableOpacity>
          </SafeAreaView>
        </View>
      </Modal>

      {/* Share PnL Modal */}
      <PnLShareModal
        position={activeSharePos}
        onClose={() => setActiveSharePos(null)}
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
  },
  contentContainer: {
    padding: 16,
    paddingBottom: 40,
  },
  composeTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: PriestTheme.colors.bg2,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: PriestTheme.colors.border,
    marginBottom: 16,
    gap: 12,
  },
  myAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: PriestTheme.colors.primaryDim,
    borderWidth: 1,
    borderColor: PriestTheme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  myAvatarText: {
    color: PriestTheme.colors.primary,
    fontWeight: '800',
    fontSize: 13,
  },
  composePlaceholder: {
    flex: 1,
    color: PriestTheme.colors.textMuted,
    fontSize: 13,
  },
  postCard: {
    backgroundColor: PriestTheme.colors.bg2,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: PriestTheme.colors.border,
    marginBottom: 12,
  },
  postHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: PriestTheme.colors.bg3,
    borderWidth: 1,
    borderColor: PriestTheme.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: PriestTheme.colors.primary,
    fontWeight: '800',
    fontSize: 14,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  authorName: {
    color: PriestTheme.colors.textPrimary,
    fontWeight: '800',
    fontSize: 14,
  },
  badgePill: {
    backgroundColor: PriestTheme.colors.primaryDim,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 6,
  },
  badgeText: {
    color: PriestTheme.colors.primary,
    fontSize: 9,
    fontWeight: '800',
  },
  authorHandle: {
    color: PriestTheme.colors.textMuted,
    fontSize: 11,
    marginTop: 2,
  },
  sentimentPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    gap: 4,
  },
  sentimentBullish: {
    backgroundColor: PriestTheme.colors.primaryDim,
  },
  sentimentBearish: {
    backgroundColor: PriestTheme.colors.dangerDim,
  },
  sentimentText: {
    fontSize: 10,
    fontWeight: '800',
  },
  sentimentTextBullish: {
    color: PriestTheme.colors.primary,
  },
  sentimentTextBearish: {
    color: PriestTheme.colors.danger,
  },
  postBody: {
    color: PriestTheme.colors.textPrimary,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 12,
  },
  embeddedPnl: {
    backgroundColor: PriestTheme.colors.bg3,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: PriestTheme.colors.borderHighlight,
    marginBottom: 12,
  },
  pnlCardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  pnlCardSymbolRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  pnlCardSymbol: {
    color: PriestTheme.colors.textPrimary,
    fontWeight: '800',
    fontSize: 15,
  },
  pnlSideBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  pnlSideBadgeLong: {
    backgroundColor: PriestTheme.colors.primaryDim,
  },
  pnlSideBadgeShort: {
    backgroundColor: PriestTheme.colors.dangerDim,
  },
  pnlSideText: {
    fontSize: 10,
    fontWeight: '800',
  },
  pnlSideTextLong: {
    color: PriestTheme.colors.primary,
  },
  pnlSideTextShort: {
    color: PriestTheme.colors.danger,
  },
  pnlRoe: {
    fontSize: 16,
    fontWeight: '900',
  },
  pnlDetailsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: PriestTheme.colors.borderSubtle,
    paddingTop: 8,
  },
  pnlDetailLabel: {
    color: PriestTheme.colors.textSecondary,
    fontSize: 11,
  },
  postFooter: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    borderTopWidth: 1,
    borderTopColor: PriestTheme.colors.borderSubtle,
    paddingTop: 10,
  },
  footerAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  actionCount: {
    color: PriestTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'flex-end',
  },
  composerSheet: {
    backgroundColor: PriestTheme.colors.bg1,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    maxHeight: '85%',
  },
  composerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  composerTitle: {
    color: PriestTheme.colors.textPrimary,
    fontSize: 18,
    fontWeight: '800',
  },
  composerInput: {
    height: 120,
    color: PriestTheme.colors.textPrimary,
    fontSize: 15,
    backgroundColor: PriestTheme.colors.bg2,
    borderRadius: 12,
    padding: 12,
    textAlignVertical: 'top',
    marginBottom: 16,
  },
  sentimentSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
  },
  selectorLabel: {
    color: PriestTheme.colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
  },
  sentimentOption: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: PriestTheme.colors.bg2,
  },
  sentimentOptionActive: {
    backgroundColor: PriestTheme.colors.primaryDim,
    borderWidth: 1,
    borderColor: PriestTheme.colors.primary,
  },
  sentimentOptionText: {
    color: PriestTheme.colors.textMuted,
    fontSize: 11,
    fontWeight: '700',
  },
  sentimentOptionTextActive: {
    color: PriestTheme.colors.primary,
  },
  attachSection: {
    marginBottom: 20,
  },
  attachPill: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: PriestTheme.colors.bg2,
    borderWidth: 1,
    borderColor: PriestTheme.colors.border,
    marginRight: 8,
  },
  attachPillActive: {
    borderColor: PriestTheme.colors.primary,
    backgroundColor: PriestTheme.colors.primaryDim,
  },
  attachPillText: {
    color: PriestTheme.colors.textPrimary,
    fontSize: 12,
    fontWeight: '700',
  },
  postSubmitBtn: {
    height: 48,
    borderRadius: 14,
    backgroundColor: PriestTheme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  postSubmitText: {
    color: '#000000',
    fontSize: 15,
    fontWeight: '800',
  },
});
