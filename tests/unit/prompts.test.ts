import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDependencies, DOC_ID } from '../helpers/fakes.js';
import { connectTestClient } from '../helpers/harness.js';

type Harness = Awaited<ReturnType<typeof connectTestClient>>;

describe('prompts', () => {
  let t: ReturnType<typeof createTestDependencies>;
  let h: Harness;

  beforeEach(async () => {
    t = createTestDependencies();
    h = await connectTestClient(t.deps);
  });

  afterEach(async () => {
    await h.close();
  });

  async function promptText(name: string, args: Record<string, string>): Promise<string> {
    const result = await h.client.getPrompt({ name, arguments: args });
    expect(result.messages.length).toBeGreaterThan(0);
    return result.messages
      .map((message) => {
        expect(message.role).toBe('user');
        return message.content.type === 'text' ? message.content.text : '';
      })
      .join('\n');
  }

  it('lists the four prompts with their arguments', async () => {
    const { prompts } = await h.client.listPrompts();
    const byName = new Map(prompts.map((prompt) => [prompt.name, prompt]));
    expect([...byName.keys()].sort()).toEqual([
      'create_meeting_notes',
      'format_document',
      'rewrite_document',
      'summarize_document',
    ]);
    for (const prompt of prompts) expect(prompt.description).toBeTruthy();

    const args = (name: string) =>
      Object.fromEntries(
        (byName.get(name)?.arguments ?? []).map((arg) => [arg.name, arg.required ?? false]),
      );
    expect(args('summarize_document')).toEqual({ documentId: true, focus: false });
    expect(args('rewrite_document')).toEqual({ documentId: true, instructions: true });
    expect(args('format_document')).toEqual({ documentId: true, styleGuide: false });
    expect(args('create_meeting_notes')).toEqual({
      title: true,
      date: false,
      attendees: false,
      notes: false,
    });
  });

  it('summarize_document reads the document without modifying it', async () => {
    const text = await promptText('summarize_document', { documentId: DOC_ID, focus: 'budget' });
    expect(text).toContain(DOC_ID);
    expect(text).toContain('get_document');
    expect(text).toContain('budget');
    expect(text).toMatch(/do not modify/i);
  });

  it('rewrite_document preserves unrelated content and edits from the end backwards', async () => {
    const text = await promptText('rewrite_document', {
      documentId: DOC_ID,
      instructions: 'Make the tone more formal.',
    });
    expect(text).toContain('Make the tone more formal.');
    for (const tool of [
      'get_document',
      'find_text',
      'replace_text',
      'delete_text',
      'insert_text',
    ]) {
      expect(text).toContain(tool);
    }
    expect(text).toMatch(/preserve all content/i);
    expect(text).toMatch(/from the end of the document backwards/i);
  });

  it('format_document only changes formatting and uses the formatting tools', async () => {
    const withGuide = await promptText('format_document', {
      documentId: DOC_ID,
      styleGuide: 'Headings in HEADING_2.',
    });
    expect(withGuide).toContain('Headings in HEADING_2.');
    for (const tool of [
      'get_document',
      'set_paragraph_style',
      'find_text',
      'format_text',
      'create_bulleted_list',
    ]) {
      expect(withGuide).toContain(tool);
    }
    expect(withGuide).toMatch(/only change formatting/i);
    expect(withGuide).toMatch(/from the end of the document backwards/i);

    const withoutGuide = await promptText('format_document', { documentId: DOC_ID });
    expect(withoutGuide).toMatch(/no style guide was given/i);
  });

  it('create_meeting_notes builds a new document from the provided details', async () => {
    const text = await promptText('create_meeting_notes', {
      title: 'Sprint Planning',
      date: '2026-09-11',
      attendees: 'Ammar, Sara',
      notes: 'Decided to ship v1 on Friday.',
    });
    for (const expected of [
      'Sprint Planning',
      '2026-09-11',
      'Ammar, Sara',
      'Decided to ship v1 on Friday.',
      'create_document',
      'append_text',
      'set_paragraph_style',
      'create_bulleted_list',
    ]) {
      expect(text).toContain(expected);
    }
    expect(text).toMatch(/do not invent/i);

    const minimal = await promptText('create_meeting_notes', { title: 'Standup' });
    expect(minimal).toContain('Standup');
    expect(minimal).toContain("today's date");
  });

  it('rejects a prompt request missing a required argument', async () => {
    await expect(
      h.client.getPrompt({ name: 'rewrite_document', arguments: { documentId: DOC_ID } }),
    ).rejects.toThrow();
  });

  it('never calls Google', async () => {
    await promptText('summarize_document', { documentId: DOC_ID });
    expect(t.docs.getDocument).not.toHaveBeenCalled();
    expect(t.drive.listFiles).not.toHaveBeenCalled();
  });
});
