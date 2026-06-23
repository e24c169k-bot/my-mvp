import { supabase } from '@/lib/supabase'

export async function getClientSession() {
  const {
    data: { user },
    error
  } = await supabase.auth.getUser()

  if (error) return { user: null, sessionError: error }
  return { user, sessionError: null }
}

export async function getUserTeam(userId) {
  const { data, error } = await supabase
    .from('team_members')
    .select('team_id, teams(name)')
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle()

  if (error) return { team: null, teamError: error }
  return { team: data, teamError: null }
}
