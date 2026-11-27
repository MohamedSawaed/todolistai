/**
 * Messages that come from the server or from Supabase sign-in and are shown through
 * t(err.message). Listed here so the translation test makes sure they're translated.
 */
import { msg } from "../i18n";

export const KNOWN_SERVER_MESSAGES = [
  // app server
  msg("Please sign in to continue."),
  msg("Please check the highlighted fields."),
  msg("Something went wrong. Your changes were not saved."),
  msg("Event not found"),
  msg("Task not found"),
  msg("Note not found"),
  msg("Proposal not found"),
  msg("This event was changed elsewhere. Review the latest version and try again."),
  msg("This time overlaps another event."),
  msg("This suggestion expired. Ask the assistant again for a fresh one."),
  msg("This suggestion is already being applied."),
  msg("Only applied suggestions can be undone."),
  msg("The assistant is busy right now. Please try again in a moment."),
  msg("The assistant is busy. Try again in a moment."),
  msg("Couldn't reach the AI service. Check the server's connection."),
  msg("The AI service had a problem. Please try again."),
  msg("Something went wrong with the assistant."),
  msg("The assistant's response was cut off. Please try a shorter request."),
  msg("The AI assistant isn't set up on this server yet. Add ANTHROPIC_API_KEY to .env.local and restart the server."),
  msg("The AI isn't set up on this server."),
  msg("The briefing couldn't be written right now."),
  msg("Phone notifications need the online version with push keys configured."),
  msg("This device isn't registered yet. Turn phone notifications off and on again."),
  msg("Request body must be JSON"),
  // Supabase sign-in
  msg("Invalid login credentials"),
  msg("User already registered"),
  msg("Email not confirmed"),
  msg("Password should be at least 6 characters."),
  msg("Unable to validate email address: invalid format"),
  msg("Email rate limit exceeded"),
];
