import { ScrollView, Text, View } from 'react-native';
import { roadmapFor } from '@sanad/contracts/roadmap';
import { ComingSoon, Pill, s, theme } from '@/components/ui';

/**
 * Sanad Community — a preview.
 *
 * Every post below is written into this file. Nothing is fetched, nothing is
 * stored, and no control does anything. The sample exists so the shape of the
 * idea is arguable — what a question looks like, where a TA answers, how an AI
 * reply is marked — not to imply a backend exists.
 */

/**
 * Sample posts, deliberately subject-neutral.
 *
 * Naming a discipline here would put a subject into application code, which CI
 * rejects. The preview is showing the shape of the interaction — a question, a
 * TA answer, an AI reply that cites a lecture — not a particular course.
 */
const SAMPLE = [
  {
    author: 'Second-year student',
    course: 'One of your courses',
    time: '2h',
    body: 'The professor said this condition has to be strictly greater than, not greater than or equal. Why does the boundary case fail?',
    replies: [
      {
        author: 'Teaching assistant',
        badge: 'TA',
        body: 'At the boundary the result is not guaranteed — you can construct a case where it breaks. That is why it is a strict inequality.',
      },
      {
        author: 'Sanad',
        badge: 'AI',
        body: 'Related moment in your Lecture 06 at 24:15 — the professor covers exactly this boundary case.',
      },
    ],
  },
  {
    author: 'Third-year student',
    course: 'Another course you follow',
    time: '1d',
    body: 'Sharing my summary of everything from this week. Corrections welcome — I am not sure about the third step.',
    replies: [
      {
        author: 'Classmate',
        badge: null,
        body: 'Step three looks right, but I would check it against the lecture around the 30-minute mark.',
      },
    ],
  },
];

export default function CommunityScreen() {
  return (
    <ScrollView style={s.screen}>
      <Text style={s.h1}>Sanad Community</Text>

      <ComingSoon
        title="Ask, discuss, and learn with your university community"
        promise="Post a question about a lecture, answer someone else’s, and share what you worked out."
        detail="Not built yet. A social layer means moderation, abuse handling and a privacy review before it goes near student work. Everything below is a static preview written into the app — nothing is loaded and nothing is stored."
      />

      <Text style={[s.h2, { marginTop: 12 }]}>Also planned here</Text>
      {roadmapFor('community').map((item) => (
        <ComingSoon
          key={item.id}
          title={item.title}
          promise={item.promise}
          detail={item.detail}
        />
      ))}

      <Text style={[s.h2, { marginTop: 12 }]}>What it will look like</Text>
      <Text style={[s.muted, { marginBottom: 10 }]}>Preview content — not real posts.</Text>

      {SAMPLE.map((post, index) => (
        <View key={index} style={[s.card, { opacity: 0.92 }]}>
          <View style={s.spread}>
            <Text style={[s.body, { fontWeight: '600', flex: 1 }]}>{post.author}</Text>
            <Text style={s.muted}>{post.time}</Text>
          </View>
          <Text style={s.muted}>{post.course}</Text>
          <Text style={[s.body, { marginTop: 8 }]}>{post.body}</Text>

          {post.replies.map((reply, replyIndex) => (
            <View
              key={replyIndex}
              style={{
                marginTop: 12,
                paddingLeft: 10,
                borderLeftWidth: 2,
                borderLeftColor: theme.line,
              }}
            >
              <View style={s.row}>
                <Pill text={reply.badge ?? 'student'} tone={reply.badge === 'AI' ? 'good' : 'neutral'} />
                <Text style={[s.body, { fontWeight: '600' }]}>{reply.author}</Text>
              </View>
              <Text style={[s.body, { marginTop: 4 }]}>{reply.body}</Text>
            </View>
          ))}
        </View>
      ))}

      <Text style={[s.muted, { marginTop: 8 }]}>
        When this is built, an answer from Sanad will follow the same rules as Ask Sanad: it
        cites the lecture it came from, it is always badged as AI, and it says nothing when
        the material does not support an answer.
      </Text>
      <View style={{ height: 40 }} />
    </ScrollView>
  );
}
