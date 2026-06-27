'use client'

import { Suspense } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { getClientSession, getUserTeam } from '@/lib/team-client'

const PITCH_RESULTS = ['見逃しS', '空振りS', 'ボール', 'ファウル', 'バント空振', 'バントF', 'ヒッティング', '申告敬遠', 'デッドボール', '打撃妨害', 'ボーク']
const POSITIONS = ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF']
const HIT_RESULTS = ['バント', 'ゴロアウト', 'フライアウト', 'ライナーアウト', 'ヒット', '2B', '3B', 'HR', '走HR', 'エン2B']
const OUT_RESULTS = ['ゴロアウト', 'フライアウト', 'ライナーアウト', 'バント']
const ADVANCE_REASONS = ['盗塁', 'タッチアップ', 'パスボール', '暴投', 'エラー・野選', 'その他']
const BASES = ['1塁', '2塁', '3塁', '本塁']
const BASE_ORDER = ['1塁', '2塁', '3塁', '本塁']
const MAX_BALLS_BEFORE_WALK = 4

function RecordContent() {
  const { id: gameId } = useParams()
  const searchParams = useSearchParams()
  const seasonId = searchParams.get('season')
  const teamIdParam = searchParams.get('team')
  const router = useRouter()

  const [teamId, setTeamId] = useState(teamIdParam || null)
  const [game, setGame] = useState(null)
  const [lineup, setLineup] = useState([])
  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState('')

  const [inning, setInning] = useState(1)
  const [inningHalf, setInningHalf] = useState('top')
  const [usBattingTurn, setUsBattingTurn] = useState('first') // first | second
  const [balls, setBalls] = useState(0)
  const [strikes, setStrikes] = useState(0)
  const [outs, setOuts] = useState(0)
  const [runners, setRunners] = useState({ '1塁': null, '2塁': null, '3塁': null })
  const [batterIndex, setBatterIndex] = useState(0)
  const [pitcherId, setPitcherId] = useState(null)
  const [scoreUs, setScoreUs] = useState(0)
  const [scoreThem, setScoreThem] = useState(0)
  const [lastPitchId, setLastPitchId] = useState(null)
  const [undoStack, setUndoStack] = useState([])
  const [opponentRunnerSeq, setOpponentRunnerSeq] = useState(1)
  const [activeBatterRunnerId, setActiveBatterRunnerId] = useState('')
  const [opponentPitcherName, setOpponentPitcherName] = useState('')
  const [dhFpPairs, setDhFpPairs] = useState([])
  const halfSwitchingRef = useRef(false)

  const [activeBatters, setActiveBatters] = useState([])
  const [reentryUsed, setReentryUsed] = useState(new Set())
  const [benchedStarters, setBenchedStarters] = useState(new Set())
  const [subTarget, setSubTarget] = useState(null)
  const [defenseSubTarget, setDefenseSubTarget] = useState(null)
  const [defenseSubPosition, setDefenseSubPosition] = useState('')
  const [runnerSubTargetBase, setRunnerSubTargetBase] = useState('')
  const [runnerSubTargetPlayerId, setRunnerSubTargetPlayerId] = useState('')

  const [panel, setPanel] = useState('main')
  const [selectedPitch, setSelectedPitch] = useState('')
  const [selectedPos, setSelectedPos] = useState('')
  const [selectedResult, setSelectedResult] = useState('')
  const [advanceKind, setAdvanceKind] = useState('')
  const [advanceReason, setAdvanceReason] = useState('')
  const [advanceRunner, setAdvanceRunner] = useState('')
  const [advanceTo, setAdvanceTo] = useState('')
  const [outRunner, setOutRunner] = useState('')
  const [scoreRunners, setScoreRunners] = useState([])

  const starters = useMemo(
    () =>
      activeBatters.length > 0
        ? activeBatters
        : lineup
            .filter((l) => l.is_starter)
            .sort((a, b) => a.batting_order - b.batting_order)
            .map((s) => ({
              battingOrder: s.batting_order,
              playerId: s.player_id,
              position: s.position,
              isStarter: true
            })),
    [activeBatters, lineup]
  )

  const batter = starters[batterIndex % (starters.length || 1)]
  const batterPlayer = lineup.find((l) => l.player_id === batter?.playerId)
  const getDefenderIdByPosition = (position) => {
    const fp = dhFpPairs.find((p) => p.fpPosition === position)
    if (fp?.fpPlayerId) return fp.fpPlayerId
    const fpLineupEntry = lineup.find((l) => l.position === `FP:${position}`)
    if (fpLineupEntry?.player_id) return fpLineupEntry.player_id
    return starters.find((s) => s.position === position)?.playerId || null
  }
  const effectivePitcherId = getDefenderIdByPosition('P') || pitcherId || null
  const effectiveCatcherId = getDefenderIdByPosition('C')
  const teamPitcher = lineup.find((l) => l.player_id === effectivePitcherId)
  const catcherEntry = lineup.find((l) => l.player_id === effectiveCatcherId)
  const isOurOffense =
    (usBattingTurn === 'first' && inningHalf === 'top') ||
    (usBattingTurn === 'second' && inningHalf === 'bottom')

  useEffect(() => {
    initialize()
  }, [gameId, teamIdParam])

  useEffect(() => {
    if (outs >= 3 && !halfSwitchingRef.current) {
      nextHalfInning()
    }
  }, [outs])

  useEffect(() => {
    // Always return to the main pitch-result panel after half-inning switch.
    setPanel('main')
    setSelectedPitch('')
    setSelectedPos('')
    setSelectedResult('')
    setAdvanceKind('')
    setAdvanceReason('')
    setAdvanceRunner('')
    setAdvanceTo('')
    setScoreRunners([])
    setActiveBatterRunnerId('')
  }, [inning, inningHalf])

  useEffect(() => {
    // Keep pitcherId aligned with defensive assignment (including FP:P).
    if (effectivePitcherId && pitcherId !== effectivePitcherId) {
      setPitcherId(effectivePitcherId)
    }
  }, [effectivePitcherId, pitcherId])

  async function initialize() {
    setLoading(true)
    setErrorMsg('')

    const { user } = await getClientSession()
    if (!user) {
      router.push('/auth')
      return
    }
    const { team, teamError } = await getUserTeam(user.id)
    if (teamError) {
      setErrorMsg(teamError.message)
      setLoading(false)
      return
    }
    if (!team?.team_id) {
      router.push('/onboarding')
      return
    }
    setTeamId(team.team_id)

    const { data: g, error: gameError } = await supabase
      .from('games')
      .select('*')
      .eq('id', gameId)
      .eq('team_id', team.team_id)
      .single()
    if (gameError) {
      setErrorMsg(gameError.message)
      setLoading(false)
      return
    }

    const { data: l, error: lineupError } = await supabase
      .from('lineups')
      .select('*, players(*)')
      .eq('game_id', gameId)
      .eq('team_id', team.team_id)
      .order('batting_order')
    if (lineupError) {
      setErrorMsg(lineupError.message)
      setLoading(false)
      return
    }

    let normalizedLineup = l || []

    // Backfill bench options for old games that stored only starters.
    if (!normalizedLineup.some((x) => !x.is_starter) && seasonId) {
      const starterIds = new Set(normalizedLineup.map((x) => x.player_id))
      const { data: seasonPlayers, error: seasonPlayersError } = await supabase
        .from('players')
        .select('*')
        .eq('season_id', seasonId)
        .eq('team_id', team.team_id)
        .order('number', { ascending: true })
      if (seasonPlayersError) {
        setErrorMsg(seasonPlayersError.message)
        setLoading(false)
        return
      }
      const benchBackfill = (seasonPlayers || [])
        .filter((p) => !starterIds.has(p.id))
        .map((p, i) => ({
          id: `bench-${p.id}`,
          game_id: gameId,
          team_id: team.team_id,
          player_id: p.id,
          batting_order: 100 + i,
          position: '',
          is_starter: false,
          players: p
        }))
      normalizedLineup = [...normalizedLineup, ...benchBackfill]
    }

    setGame(g)
    setLineup(normalizedLineup)
    setScoreUs(g?.score_us || 0)
    setScoreThem(g?.score_them || 0)

    const starterList = normalizedLineup.filter((x) => x.is_starter).sort((a, b) => a.batting_order - b.batting_order)
    setActiveBatters(
      starterList.map((s) => ({
        battingOrder: s.batting_order,
        playerId: s.player_id,
        position: s.position,
        isStarter: true
      }))
    )

    const pitcherEntry = normalizedLineup.find((x) => x.position === 'P') || normalizedLineup.find((x) => x.position === 'FP:P')
    if (pitcherEntry) setPitcherId(pitcherEntry.player_id)

    const state = g?.state_json || {}
    setInning(state.inning || 1)
    setInningHalf(state.inningHalf || 'top')
    setUsBattingTurn(state.usBattingTurn || 'first')
    setBalls(Math.max(0, Math.min(state.balls || 0, MAX_BALLS_BEFORE_WALK - 1)))
    setStrikes(state.strikes || 0)
    setOuts(state.outs || 0)
    setRunners(state.runners || { '1塁': null, '2塁': null, '3塁': null })
    setBatterIndex(state.batterIndex || 0)
    setOpponentPitcherName(state.opponentPitcherName || '')
    setDhFpPairs(Array.isArray(state.dhFpPairs) ? state.dhFpPairs : [])
    setLoading(false)
  }

  async function persistGameState(next) {
    if (!teamId) return
    const nextState = {
      inning: next.inning ?? inning,
      inningHalf: next.inningHalf ?? inningHalf,
      usBattingTurn: next.usBattingTurn ?? usBattingTurn,
      balls: next.balls ?? balls,
      strikes: next.strikes ?? strikes,
      outs: next.outs ?? outs,
      runners: next.runners ?? runners,
      batterIndex: next.batterIndex ?? batterIndex,
      opponentPitcherName: next.opponentPitcherName ?? opponentPitcherName,
      dhFpPairs: next.dhFpPairs ?? dhFpPairs
    }
    const { error } = await supabase
      .from('games')
      .update({
        score_us: next.scoreUs ?? scoreUs,
        score_them: next.scoreThem ?? scoreThem,
        state_json: nextState
      })
      .eq('id', gameId)
      .eq('team_id', teamId)
    if (error) setErrorMsg(error.message)
  }

  function snapshotState() {
    return {
      inning,
      inningHalf,
      usBattingTurn,
      balls,
      strikes,
      outs,
      runners: { ...runners },
      batterIndex,
      opponentPitcherName,
      dhFpPairs: [...dhFpPairs],
      scoreUs,
      scoreThem,
      lastPitchId,
      activeBatterRunnerId
    }
  }

  function restoreSnapshot(snapshot) {
    setInning(snapshot.inning)
    setInningHalf(snapshot.inningHalf)
    setUsBattingTurn(snapshot.usBattingTurn)
    setBalls(snapshot.balls)
    setStrikes(snapshot.strikes)
    setOuts(snapshot.outs)
    setRunners(snapshot.runners)
    setBatterIndex(snapshot.batterIndex)
    setOpponentPitcherName(snapshot.opponentPitcherName || '')
    setDhFpPairs(Array.isArray(snapshot.dhFpPairs) ? snapshot.dhFpPairs : [])
    setScoreUs(snapshot.scoreUs)
    setScoreThem(snapshot.scoreThem)
    setLastPitchId(snapshot.lastPitchId || null)
    setActiveBatterRunnerId(snapshot.activeBatterRunnerId || '')
    setPanel('main')
    setSelectedPitch('')
    setSelectedPos('')
    setSelectedResult('')
    setAdvanceKind('')
    setAdvanceReason('')
    setAdvanceRunner('')
    setAdvanceTo('')
    setScoreRunners([])
  }

  function pushUndoAction(action) {
    setUndoStack((prev) => {
      const next = [...prev, action]
      // Keep recent history bounded.
      return next.length > 20 ? next.slice(next.length - 20) : next
    })
  }

  function createOpponentRunnerId() {
    const id = `opp-${inning}-${inningHalf}-${opponentRunnerSeq}`
    setOpponentRunnerSeq((prev) => prev + 1)
    return id
  }

  function forceAdvanceOnWalk(baseRunners, batterId) {
    const nextRunners = { ...baseRunners }
    let runsScored = 0

    if (nextRunners['1塁']) {
      if (nextRunners['2塁']) {
        if (nextRunners['3塁']) runsScored += 1
        nextRunners['3塁'] = nextRunners['2塁']
      }
      nextRunners['2塁'] = nextRunners['1塁']
    }
    nextRunners['1塁'] = batterId

    return { nextRunners, runsScored }
  }

  function placeBatterWithCarry(baseRunners, batterId, destinationBase) {
    const nextRunners = { '1塁': null, '2塁': null, '3塁': null }
    let runsScored = 0
    const r1 = baseRunners['1塁']
    const r2 = baseRunners['2塁']
    const r3 = baseRunners['3塁']

    if (destinationBase === '1塁') {
      // Single: force advance one base where needed.
      if (r3) runsScored += 1
      nextRunners['3塁'] = r2 || null
      nextRunners['2塁'] = r1 || null
      nextRunners['1塁'] = batterId
      return { nextRunners, runsScored }
    }

    if (destinationBase === '2塁') {
      // Double: 1st runner must advance to 3rd unless out handling is applied separately.
      if (r3) runsScored += 1
      if (r2) runsScored += 1
      nextRunners['3塁'] = r1 || null
      nextRunners['2塁'] = batterId
      return { nextRunners, runsScored }
    }

    if (destinationBase === '3塁') {
      // Triple: all existing runners score.
      if (r1) runsScored += 1
      if (r2) runsScored += 1
      if (r3) runsScored += 1
      nextRunners['3塁'] = batterId
      return { nextRunners, runsScored }
    }

    return { nextRunners, runsScored }
  }

  const activePlayerIds = new Set(starters.map((s) => s.playerId))
  const fpPlayerIds = new Set(dhFpPairs.map((p) => p.fpPlayerId))
  if (fpPlayerIds.size === 0) {
    for (const l of lineup) {
      if (String(l.position || '').startsWith('FP:')) fpPlayerIds.add(l.player_id)
    }
  }
  const benchPlayers = lineup.filter((l) => {
    if (activePlayerIds.has(l.player_id)) return false
    if (fpPlayerIds.has(l.player_id)) return false
    if (!l.is_starter) return true
    return benchedStarters.has(l.player_id) && !reentryUsed.has(l.player_id)
  })

  function executeSubstitution(newPlayerId) {
    if (subTarget === null) return
    const outgoing = starters[subTarget]
    const incomingLineup = lineup.find((l) => l.player_id === newPlayerId)

    setActiveBatters((prev) =>
      prev.map((b, i) =>
        i === subTarget
          ? {
              ...b,
              playerId: newPlayerId,
              position: incomingLineup?.position || b.position,
              isStarter: incomingLineup?.is_starter || false
            }
          : b
      )
    )

    if (outgoing?.isStarter) setBenchedStarters((prev) => new Set([...prev, outgoing.playerId]))
    if (benchedStarters.has(newPlayerId)) setReentryUsed((prev) => new Set([...prev, newPlayerId]))

    setRunners((prev) => {
      const nr = { ...prev }
      for (const base of ['1塁', '2塁', '3塁']) {
        if (nr[base] === outgoing?.playerId) nr[base] = newPlayerId
      }
      persistGameState({ runners: nr })
      return nr
    })
    if (outgoing?.position === 'P') setPitcherId(newPlayerId)
    setPanel('main')
    setSubTarget(null)
  }

  function executeDefenseSubstitution(newPlayerId, toPosition) {
    if (defenseSubTarget === null) return
    const outgoing = starters.find((s) => s.playerId === defenseSubTarget) || null
    const outgoingLineup = lineup.find((l) => l.player_id === defenseSubTarget)
    const outgoingFpPair = dhFpPairs.find((p) => p.fpPlayerId === defenseSubTarget)
    const outgoingIsFp = !!outgoingFpPair || String(outgoingLineup?.position || '').startsWith('FP:')
    const incomingLineup = lineup.find((l) => l.player_id === newPlayerId)
    const fallbackFpPosition = String(outgoingLineup?.position || '').startsWith('FP:')
      ? String(outgoingLineup.position).replace('FP:', '')
      : ''
    const finalPosition = toPosition || outgoing?.position || outgoingFpPair?.fpPosition || fallbackFpPosition || incomingLineup?.position || ''

    if (outgoing) {
      setActiveBatters((prev) =>
        prev.map((b) =>
          b.playerId === defenseSubTarget
            ? {
                ...b,
                playerId: newPlayerId,
                position: finalPosition || b.position,
                isStarter: incomingLineup?.is_starter || false
              }
            : b
        )
      )
    }

    if (outgoing?.isStarter) setBenchedStarters((prev) => new Set([...prev, outgoing.playerId]))
    if (benchedStarters.has(newPlayerId)) setReentryUsed((prev) => new Set([...prev, newPlayerId]))

    let nextDhFpPairs = dhFpPairs
    if (outgoingIsFp) {
      nextDhFpPairs = dhFpPairs.map((pair) =>
        pair.fpPlayerId === defenseSubTarget
          ? { ...pair, fpPlayerId: newPlayerId, fpPosition: finalPosition || pair.fpPosition }
          : pair
      )
      setLineup((prev) =>
        prev.map((entry) => {
          if (entry.player_id === defenseSubTarget && String(entry.position || '').startsWith('FP:')) {
            return { ...entry, position: '' }
          }
          if (entry.player_id === newPlayerId) {
            return { ...entry, position: `FP:${finalPosition}` }
          }
          return entry
        })
      )
      setDhFpPairs(nextDhFpPairs)
      persistGameState({ dhFpPairs: nextDhFpPairs })
    }

    if (finalPosition === 'P') setPitcherId(newPlayerId)
    else if ((outgoing?.position || outgoingFpPair?.fpPosition || fallbackFpPosition) === 'P') setPitcherId(null)

    setPanel('main')
    setDefenseSubTarget(null)
    setDefenseSubPosition('')
  }

  function executeRunnerSub(newPlayerId) {
    if (!runnerSubTargetBase || !runnerSubTargetPlayerId) return
    const outgoingPlayerId = runnerSubTargetPlayerId
    const incomingLineup = lineup.find((l) => l.player_id === newPlayerId)
    const outgoingIndex = starters.findIndex((s) => s.playerId === outgoingPlayerId)
    const outgoing = outgoingIndex >= 0 ? starters[outgoingIndex] : null

    if (outgoingIndex >= 0) {
      setActiveBatters((prev) =>
        prev.map((b, i) =>
          i === outgoingIndex
            ? {
                ...b,
                playerId: newPlayerId,
                position: incomingLineup?.position || b.position,
                isStarter: incomingLineup?.is_starter || false
              }
            : b
        )
      )
    }

    if (outgoing?.isStarter) setBenchedStarters((prev) => new Set([...prev, outgoing.playerId]))
    if (benchedStarters.has(newPlayerId)) setReentryUsed((prev) => new Set([...prev, newPlayerId]))

    const nextRunners = { ...runners, [runnerSubTargetBase]: newPlayerId }
    setRunners(nextRunners)
    persistGameState({ runners: nextRunners })
    setRunnerSubTargetBase('')
    setRunnerSubTargetPlayerId('')
    setPanel('main')
  }

  const hasRunnerP = teamPitcher && Object.values(runners).some((r) => r === effectivePitcherId)
  const hasRunnerC = catcherEntry && Object.values(runners).some((r) => r === catcherEntry.player_id)
  const canTemporary = outs === 2 && (hasRunnerP || hasRunnerC)

  function getTemporaryCandidate() {
    const eligible = starters.filter((l) => l.position !== 'P' && l.position !== 'C')
    if (eligible.length === 0) return null
    const currentOrder = batter?.battingOrder || 1
    const sorted = [...eligible].sort((a, b) => a.battingOrder - b.battingOrder)
    const before = sorted.filter((l) => l.battingOrder < currentOrder)
    return before.length > 0 ? before[before.length - 1] : sorted[sorted.length - 1]
  }

  async function savePitch(pitchType, result, advReason) {
    if (!teamId) return null
    const { data, error } = await supabase
      .from('pitches')
      .insert({
        game_id: gameId,
        team_id: teamId,
        inning,
        inning_half: inningHalf,
        batter_id: isOurOffense ? batter?.playerId || null : null,
        pitcher_id: isOurOffense ? null : effectivePitcherId || null,
        pitch_type: pitchType,
        result,
        advance_reason: advReason || null
      })
      .select('id')
      .single()
    if (error) {
      setErrorMsg(error.message)
      return null
    }
    setLastPitchId(data.id)
    return data.id
  }

  async function savePA(result, positionHitTo) {
    if (!isOurOffense) return
    if (!teamId) return
    const { data, error } = await supabase
      .from('plate_appearances')
      .insert({
        game_id: gameId,
        team_id: teamId,
        player_id: batter?.playerId || null,
        inning,
        result,
        position_hit_to: positionHitTo || null
      })
      .select('id')
      .single()
    if (error) setErrorMsg(error.message)
    return data?.id || null
  }

  function nextBatter() {
    const nextIndex = isOurOffense ? batterIndex + 1 : batterIndex
    if (isOurOffense) setBatterIndex(nextIndex)
    setBalls(0)
    setStrikes(0)
    return nextIndex
  }

  function nextHalfInning() {
    if (halfSwitchingRef.current) return
    halfSwitchingRef.current = true

    const nextHalf = inningHalf === 'top' ? 'bottom' : 'top'
    const nextInning = inningHalf === 'top' ? inning : inning + 1
    const emptyRunners = { '1塁': null, '2塁': null, '3塁': null }
    setBalls(0)
    setStrikes(0)
    setOuts(0)
    setRunners(emptyRunners)
    setInning(nextInning)
    setInningHalf(nextHalf)
    persistGameState({
      inning: nextInning,
      inningHalf: nextHalf,
      usBattingTurn,
      balls: 0,
      strikes: 0,
      outs: 0,
      runners: emptyRunners
    })
    setPanel('main')
    setSelectedPitch('')
    setSelectedPos('')
    setSelectedResult('')
    setAdvanceKind('')
    setAdvanceReason('')
    setAdvanceRunner('')
    setAdvanceTo('')
    setScoreRunners([])
    setActiveBatterRunnerId('')

    halfSwitchingRef.current = false
  }

  async function selectPitch(pitch) {
    const action = {
      before: snapshotState(),
      pitchIds: [],
      paIds: []
    }
    setSelectedPitch(pitch)
    setErrorMsg('')
    setActiveBatterRunnerId('')
    if (pitch === 'ヒッティング') {
      setPanel('hitting')
      return
    }
    if (pitch === 'ボーク') {
      setAdvanceReason('ボーク')
      const pitchId = await savePitch(pitch, 'ボーク', 'ボーク')
      if (pitchId) action.pitchIds.push(pitchId)
      setPanel('error')
      pushUndoAction(action)
      return
    }

    if (['見逃しS', '空振りS', 'バント空振'].includes(pitch)) {
      const newS = strikes + 1
      if (newS >= 3) {
        const pitchId = await savePitch(pitch, '三振', null)
        if (pitchId) action.pitchIds.push(pitchId)
        const paId = await savePA('三振', null)
        if (paId) action.paIds.push(paId)
        const newOuts = outs + 1
        const nextIndex = nextBatter()
        setOuts(newOuts)
        persistGameState({ outs: newOuts, balls: 0, strikes: 0, batterIndex: nextIndex })
      } else {
        setStrikes(newS)
        const pitchId = await savePitch(pitch, null, null)
        if (pitchId) action.pitchIds.push(pitchId)
        persistGameState({ strikes: newS })
      }
      setPanel('error')
      pushUndoAction(action)
      return
    }

    if (pitch === 'ボール') {
      // Clamp to valid range to avoid accidental early walk on stale state.
      const normalizedBalls = Math.max(0, Math.min(balls, MAX_BALLS_BEFORE_WALK - 1))
      const newB = normalizedBalls + 1
      if (newB === MAX_BALLS_BEFORE_WALK) {
        const pitchId = await savePitch(pitch, '四球', null)
        if (pitchId) action.pitchIds.push(pitchId)
        const paId = await savePA('四球', null)
        if (paId) action.paIds.push(paId)
        const batterRunnerId = isOurOffense ? batter?.playerId : createOpponentRunnerId()
        setActiveBatterRunnerId(batterRunnerId || '')
        const { nextRunners, runsScored } = forceAdvanceOnWalk(runners, batterRunnerId)
        const nextIndex = nextBatter()
        const nextScore = isOurOffense ? scoreUs + runsScored : scoreThem + runsScored
        setRunners(nextRunners)
        if (isOurOffense) setScoreUs(nextScore)
        else setScoreThem(nextScore)
        persistGameState({
          runners: nextRunners,
          scoreUs: isOurOffense ? nextScore : scoreUs,
          scoreThem: isOurOffense ? scoreThem : nextScore,
          balls: 0,
          strikes: 0,
          batterIndex: nextIndex
        })
      } else {
        setBalls(newB)
        const pitchId = await savePitch(pitch, null, null)
        if (pitchId) action.pitchIds.push(pitchId)
        persistGameState({ balls: newB })
      }
      setPanel('error')
      pushUndoAction(action)
      return
    }

    if (['申告敬遠', 'デッドボール', '打撃妨害'].includes(pitch)) {
      const pitchId = await savePitch(pitch, pitch, null)
      if (pitchId) action.pitchIds.push(pitchId)
      const paId = await savePA(pitch, null)
      if (paId) action.paIds.push(paId)
      const batterRunnerId = isOurOffense ? batter?.playerId : createOpponentRunnerId()
      setActiveBatterRunnerId(batterRunnerId || '')
      const { nextRunners, runsScored } = forceAdvanceOnWalk(runners, batterRunnerId)
      const nextScore = isOurOffense ? scoreUs + runsScored : scoreThem + runsScored
      const nextIndex = nextBatter()
      setRunners(nextRunners)
      if (isOurOffense) setScoreUs(nextScore)
      else setScoreThem(nextScore)
      persistGameState({
        runners: nextRunners,
        scoreUs: isOurOffense ? nextScore : scoreUs,
        scoreThem: isOurOffense ? scoreThem : nextScore,
        balls: 0,
        strikes: 0,
        batterIndex: nextIndex
      })
      setPanel('error')
      pushUndoAction(action)
      return
    }

    if (pitch === 'ファウル' || pitch === 'バントF') {
      // Two-strike bunt foul is an automatic strikeout.
      if (pitch === 'バントF' && strikes >= 2) {
        const pitchId = await savePitch(pitch, '三振', null)
        if (pitchId) action.pitchIds.push(pitchId)
        const paId = await savePA('三振', null)
        if (paId) action.paIds.push(paId)
        const newOuts = outs + 1
        const nextIndex = nextBatter()
        setOuts(newOuts)
        persistGameState({ outs: newOuts, balls: 0, strikes: 0, batterIndex: nextIndex })
        setPanel('error')
        pushUndoAction(action)
        return
      }

      const nextStrikes = strikes < 2 ? strikes + 1 : strikes
      setStrikes(nextStrikes)
      const pitchId = await savePitch(pitch, null, null)
      if (pitchId) action.pitchIds.push(pitchId)
      persistGameState({ strikes: nextStrikes })
      setPanel('error')
      pushUndoAction(action)
      return
    }
  }

  function selectPosition(pos) {
    setSelectedPos(pos)
    setPanel('result')
  }

  function selectResult(res) {
    setSelectedResult(res)
    if (OUT_RESULTS.includes(res) && Object.values(runners).some((r) => r)) {
      setPanel('dp')
    } else {
      applyResult(res, res)
    }
  }

  function selectDP(dpType) {
    applyResult(selectedResult, dpType)
  }

  async function applyResult(res, finalRes) {
    const action = {
      before: snapshotState(),
      pitchIds: [],
      paIds: []
    }
    const pitchId = await savePitch('ヒッティング', finalRes, null)
    if (pitchId) action.pitchIds.push(pitchId)
    const paId = await savePA(finalRes, selectedPos)
    if (paId) action.paIds.push(paId)

    setBalls(0)
    setStrikes(0)

    const isOut = OUT_RESULTS.includes(res) || finalRes === 'DP' || finalRes === 'TP'
    if (isOut) {
      const addOuts = finalRes === 'TP' ? 3 : finalRes === 'DP' ? 2 : 1
      const newOuts = Math.min(outs + addOuts, 3)
      const nextIndex = nextBatter()
      setOuts(newOuts)
      persistGameState({ outs: newOuts, balls: 0, strikes: 0, batterIndex: nextIndex })
      if (newOuts >= 3) return
    } else {
      let nextRunners = { ...runners }
      const batterRunnerId = isOurOffense ? batter?.playerId : createOpponentRunnerId()
      setActiveBatterRunnerId(batterRunnerId || '')
      let nextScore = isOurOffense ? scoreUs : scoreThem
      const isHomeRun = res === 'HR' || res === '走HR'
      if (res === 'ヒット') {
        const placed = placeBatterWithCarry(runners, batterRunnerId, '1塁')
        nextRunners = placed.nextRunners
        nextScore += placed.runsScored
      } else if (res === '2B' || res === 'エン2B') {
        const placed = placeBatterWithCarry(runners, batterRunnerId, '2塁')
        nextRunners = placed.nextRunners
        nextScore += placed.runsScored
      } else if (res === '3B') {
        const placed = placeBatterWithCarry(runners, batterRunnerId, '3塁')
        nextRunners = placed.nextRunners
        nextScore += placed.runsScored
      }
      else if (res === 'HR' || res === '走HR') {
        nextScore += 1 + Object.values(runners).filter((r) => r).length
        nextRunners = { '1塁': null, '2塁': null, '3塁': null }
      }
      const nextIndex = nextBatter()
      setRunners(nextRunners)
      if (isOurOffense) setScoreUs(nextScore)
      else setScoreThem(nextScore)
      persistGameState({
        runners: nextRunners,
        scoreUs: isOurOffense ? nextScore : scoreUs,
        scoreThem: isOurOffense ? scoreThem : nextScore,
        balls: 0,
        strikes: 0,
        batterIndex: nextIndex
      })

      // Home runs are auto-finalized; no extra advance/score prompt needed.
      if (isHomeRun) {
        pushUndoAction(action)
        confirmAll()
        return
      }
    }
    setPanel('error')
    pushUndoAction(action)
  }

  function startAdvanceFlow(kind) {
    setAdvanceKind(kind)
    if (advanceReason === 'ボーク') {
      setPanel(kind === 'score' ? 'score' : 'advance')
      return
    }
    setAdvanceReason('')
    setPanel('reason')
  }

  function selectReason(reason) {
    setAdvanceReason(reason)
    setPanel(advanceKind === 'score' ? 'score' : 'advance')
  }

  async function confirmAdvance() {
    const action = {
      before: snapshotState(),
      pitchIds: [],
      paIds: [],
      advanceIds: []
    }
    if (!advanceRunner || !advanceTo) {
      if (advanceKind === 'both') setPanel('score')
      else confirmAll()
      return
    }

    const currentBase = ['1塁', '2塁', '3塁'].find((base) => runners[base] === advanceRunner) || null
    const currentIndex = currentBase ? BASE_ORDER.indexOf(currentBase) : -1 // batter from home plate
    const targetIndex = BASE_ORDER.indexOf(advanceTo)
    if (targetIndex < 0) {
      setErrorMsg('進先が不正です。')
      return
    }
    if (targetIndex <= currentIndex) {
      setErrorMsg('走者は前の塁にしか進めません。')
      return
    }
    if (advanceTo !== '本塁') {
      const occupiedRunner = runners[advanceTo]
      if (occupiedRunner && occupiedRunner !== advanceRunner) {
        setErrorMsg(`${advanceTo}にはすでに走者がいます。先に前の走者を進めてください。`)
        return
      }
    }

    let nextRunners = { ...runners }
    let nextScore = isOurOffense ? scoreUs : scoreThem
    for (const base of ['1塁', '2塁', '3塁']) {
      if (nextRunners[base] === advanceRunner) nextRunners[base] = null
    }
    if (advanceTo === '本塁') nextScore += 1
    else nextRunners[advanceTo] = advanceRunner

    setRunners(nextRunners)
    if (isOurOffense) setScoreUs(nextScore)
    else setScoreThem(nextScore)
    persistGameState({
      runners: nextRunners,
      scoreUs: isOurOffense ? nextScore : scoreUs,
      scoreThem: isOurOffense ? scoreThem : nextScore
    })

    if (lastPitchId && teamId) {
      const { data, error } = await supabase
        .from('runner_advances')
        .insert({
        pitch_id: lastPitchId,
        team_id: teamId,
        runner_id: advanceRunner,
        from_base: null,
        to_base: advanceTo,
        reason: advanceReason || 'その他'
        })
        .select('id')
        .single()
      if (error) {
        setErrorMsg(error.message)
        return
      }
      if (data?.id) action.advanceIds.push(data.id)
    }
    if (advanceKind === 'both') setPanel('score')
    else confirmAll()
    pushUndoAction(action)
  }

  async function confirmScore() {
    const action = {
      before: snapshotState(),
      pitchIds: [],
      paIds: [],
      advanceIds: []
    }
    const cnt = scoreRunners.length
    const nextScore = (isOurOffense ? scoreUs : scoreThem) + cnt
    const nextRunners = { ...runners }
    for (const base of ['1塁', '2塁', '3塁']) {
      if (scoreRunners.includes(nextRunners[base])) nextRunners[base] = null
    }
    if (isOurOffense) setScoreUs(nextScore)
    else setScoreThem(nextScore)
    setRunners(nextRunners)
    persistGameState({
      runners: nextRunners,
      scoreUs: isOurOffense ? nextScore : scoreUs,
      scoreThem: isOurOffense ? scoreThem : nextScore
    })

    if (lastPitchId && teamId) {
      for (const runnerId of scoreRunners) {
        const { data, error } = await supabase
          .from('runner_advances')
          .insert({
          pitch_id: lastPitchId,
          team_id: teamId,
          runner_id: runnerId,
          from_base: null,
          to_base: '本塁',
          reason: advanceReason || 'その他'
          })
          .select('id')
          .single()
        if (error) {
          setErrorMsg(error.message)
          return
        }
        if (data?.id) action.advanceIds.push(data.id)
      }
    }
    confirmAll()
    pushUndoAction(action)
  }

  async function confirmRunnerOut() {
    if (!outRunner) return
    const action = {
      before: snapshotState(),
      pitchIds: [],
      paIds: [],
      advanceIds: []
    }

    const nextRunners = { ...runners }
    for (const base of ['1塁', '2塁', '3塁']) {
      if (nextRunners[base] === outRunner) nextRunners[base] = null
    }
    const newOuts = Math.min(outs + 1, 3)

    setRunners(nextRunners)
    setOuts(newOuts)
    persistGameState({ runners: nextRunners, outs: newOuts })

    if (lastPitchId && teamId) {
      const { data, error } = await supabase
        .from('runner_advances')
        .insert({
          pitch_id: lastPitchId,
          team_id: teamId,
          runner_id: outRunner,
          from_base: null,
          to_base: 'OUT',
          reason: 'ランナーアウト'
        })
        .select('id')
        .single()
      if (error) {
        setErrorMsg(error.message)
        return
      }
      if (data?.id) action.advanceIds.push(data.id)
    }

    confirmAll()
    pushUndoAction(action)
  }

  function confirmAll() {
    setPanel('main')
    setSelectedPitch('')
    setSelectedPos('')
    setSelectedResult('')
    setAdvanceKind('')
    setAdvanceReason('')
    setAdvanceRunner('')
    setAdvanceTo('')
    setOutRunner('')
    setScoreRunners([])
    setActiveBatterRunnerId('')
  }

  function confirmTemporary() {
    const candidate = getTemporaryCandidate()
    if (!candidate) return
    const targetBase = hasRunnerP
      ? Object.keys(runners).find((b) => runners[b] === effectivePitcherId)
      : Object.keys(runners).find((b) => runners[b] === catcherEntry?.player_id)
    if (!targetBase) return
    const nextRunners = { ...runners, [targetBase]: candidate.playerId }
    setRunners(nextRunners)
    persistGameState({ runners: nextRunners })
    setPanel('main')
  }

  async function applyUndoAction(action) {
    if (!action || !teamId) return false
    setErrorMsg('')

    if (action.advanceIds && action.advanceIds.length > 0) {
      const { error } = await supabase
        .from('runner_advances')
        .delete()
        .in('id', action.advanceIds)
        .eq('team_id', teamId)
      if (error) {
        setErrorMsg(error.message)
        return false
      }
    }

    if (action.pitchIds.length > 0) {
      const { error } = await supabase
        .from('runner_advances')
        .delete()
        .in('pitch_id', action.pitchIds)
        .eq('team_id', teamId)
      if (error) {
        setErrorMsg(error.message)
        return false
      }
    }

    if (action.paIds.length > 0) {
      const { error } = await supabase
        .from('plate_appearances')
        .delete()
        .in('id', action.paIds)
        .eq('team_id', teamId)
      if (error) {
        setErrorMsg(error.message)
        return false
      }
    }

    if (action.pitchIds.length > 0) {
      const { error } = await supabase
        .from('pitches')
        .delete()
        .in('id', action.pitchIds)
        .eq('team_id', teamId)
      if (error) {
        setErrorMsg(error.message)
        return false
      }
    }

    restoreSnapshot(action.before)
    const { error: gameError } = await supabase
      .from('games')
      .update({
        score_us: action.before.scoreUs,
        score_them: action.before.scoreThem,
        state_json: {
          inning: action.before.inning,
          inningHalf: action.before.inningHalf,
          usBattingTurn: action.before.usBattingTurn,
          balls: action.before.balls,
          strikes: action.before.strikes,
          outs: action.before.outs,
          runners: action.before.runners,
          batterIndex: action.before.batterIndex,
          opponentPitcherName: action.before.opponentPitcherName || '',
          dhFpPairs: Array.isArray(action.before.dhFpPairs) ? action.before.dhFpPairs : []
        }
      })
      .eq('id', gameId)
      .eq('team_id', teamId)
    if (gameError) {
      setErrorMsg(gameError.message)
      return false
    }
    return true
  }

  async function undoLastInput() {
    if (undoStack.length === 0 || !teamId) return
    const action = undoStack[undoStack.length - 1]
    const ok = await applyUndoAction(action)
    if (!ok) return
    setUndoStack((prev) => prev.slice(0, -1))
  }

  async function undoTwoInputs() {
    if (undoStack.length === 0 || !teamId) return
    const current = [...undoStack]
    const last = current.pop()
    const ok1 = await applyUndoAction(last)
    if (!ok1) return

    const second = current.pop()
    if (second) {
      const ok2 = await applyUndoAction(second)
      if (!ok2) return
    }

    setUndoStack((prev) => prev.slice(0, Math.max(0, prev.length - 2)))
  }

  const runnerList = Object.entries(runners).filter(([, id]) => id)
  const runnerPlayers = runnerList.map(([base, pid]) => ({
    base,
    player: lineup.find((l) => l.player_id === pid)?.players || { name: String(pid).startsWith('opp-') ? '相手走者' : '走者' },
    pid
  }))

  if (loading) return <div className="flex items-center justify-center min-h-screen"><p className="text-gray-500">読み込み中...</p></div>

  return (
    <div className="max-w-md mx-auto min-h-screen bg-white">
      <header className="bg-gradient-to-r from-green-900 to-green-700 text-white px-4 py-3 flex items-center justify-between">
        <h1 className="text-base font-semibold">S5: 試合記録</h1>
        <Link href={`/games?season=${seasonId}&team=${teamId}`} className="text-xs text-green-200">← 試合一覧</Link>
      </header>

      <div className="p-4">
        {errorMsg && <p className="text-sm text-red-600 mb-2">{errorMsg}</p>}

        <div className="bg-green-900 text-white rounded-xl p-4 mb-4">
          <div className="flex justify-between items-center mb-3">
            <span className="text-sm">{inning}回{inningHalf === 'top' ? '表' : '裏'} vs {game?.opponent}</span>
            <span className="text-xl font-bold">{scoreUs} - {scoreThem}</span>
          </div>

          <div className="flex justify-between items-center mb-3 text-sm">
            <div>
              <div className="text-green-300 text-xs">{isOurOffense ? '打者' : '相手打者'}</div>
              <div className="font-bold">
                {isOurOffense ? `${batterPlayer?.players?.name || '—'} #${batterPlayer?.players?.number || '-'}` : '相手打者'}
              </div>
            </div>
            <div className="text-right">
              <div className="text-green-300 text-xs">{isOurOffense ? '相手投手' : '自チーム投手'}</div>
              <div className="font-bold">
                {isOurOffense ? (opponentPitcherName || '未入力') : teamPitcher?.players?.name || '未入力'}
              </div>
            </div>
          </div>

          <div className="flex justify-center gap-6 bg-black/30 rounded-lg py-2 px-4 mb-3">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-bold text-white/80">B</span>
              <div className="flex gap-1">{[0, 1, 2, 3].map((i) => <div key={i} className={`w-3.5 h-3.5 rounded-full border-2 ${i < balls ? 'bg-green-400 border-green-300' : 'border-white/40'}`} />)}</div>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-bold text-white/80">S</span>
              <div className="flex gap-1">{[0, 1, 2].map((i) => <div key={i} className={`w-3.5 h-3.5 rounded-full border-2 ${i < strikes ? 'bg-yellow-400 border-yellow-300' : 'border-white/40'}`} />)}</div>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-bold text-white/80">O</span>
              <div className="flex gap-1">{[0, 1, 2].map((i) => <div key={i} className={`w-3.5 h-3.5 rounded-full border-2 ${i < outs ? 'bg-red-400 border-red-300' : 'border-white/40'}`} />)}</div>
            </div>
          </div>

          <div className="relative w-32 h-32 mx-auto mb-2">
            <div className="absolute inset-4 border-2 border-white/30 rotate-45 rounded-sm" />
            <div
              className={`absolute w-6 h-6 border-2 rotate-45 rounded-sm ${runners['2塁'] ? 'bg-yellow-400 border-yellow-200' : 'bg-white/10 border-white/40'}`}
              style={{ top: 2, left: '50%', marginLeft: -12 }}
              title={runners['2塁'] ? '2塁: 走者あり' : '2塁: 走者なし'}
            />
            <div
              className={`absolute w-6 h-6 border-2 rotate-45 rounded-sm ${runners['1塁'] ? 'bg-yellow-400 border-yellow-200' : 'bg-white/10 border-white/40'}`}
              style={{ top: '50%', marginTop: -12, right: 2 }}
              title={runners['1塁'] ? '1塁: 走者あり' : '1塁: 走者なし'}
            />
            <div
              className={`absolute w-6 h-6 border-2 rotate-45 rounded-sm ${runners['3塁'] ? 'bg-yellow-400 border-yellow-200' : 'bg-white/10 border-white/40'}`}
              style={{ top: '50%', marginTop: -12, left: 2 }}
              title={runners['3塁'] ? '3塁: 走者あり' : '3塁: 走者なし'}
            />
            <div
              className="absolute w-5 h-5 bg-white/20 border-2 border-white/40"
              style={{ bottom: 2, left: '50%', marginLeft: -10, clipPath: 'polygon(50% 0%, 0% 38%, 0% 100%, 100% 100%, 100% 38%)' }}
            />
          </div>

          <div className="mt-2 grid grid-cols-3 gap-1 text-[10px] !text-white" style={{ color: '#fff' }}>
            {['1塁', '2塁', '3塁'].map((base) => {
              const runnerId = runners[base]
              const runnerName = runnerId
                ? (lineup.find((l) => l.player_id === runnerId)?.players?.name || (String(runnerId).startsWith('opp-') ? '相手走者' : '走者'))
                : 'なし'
              return (
                <div key={base} className="bg-black/60 rounded px-1.5 py-1 text-center !text-white" style={{ color: '#fff' }}>
                  <span className="font-semibold !text-white" style={{ color: '#fff' }}>{base}</span>: {runnerName}
                </div>
              )
            })}
          </div>
        </div>

        {dhFpPairs.length > 0 && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-2 mb-3 text-xs text-blue-900">
            <p className="font-semibold mb-1">DH / FP</p>
            {dhFpPairs.map((pair, idx) => {
              const dhName = lineup.find(l => l.player_id === pair.dhPlayerId)?.players?.name || 'DH'
              const fpName = lineup.find(l => l.player_id === pair.fpPlayerId)?.players?.name || 'FP'
              return (
                <p key={`${pair.dhPlayerId}-${pair.fpPlayerId}-${idx}`}>
                  {dhName} (DH) / {fpName} (FP:{pair.fpPosition})
                </p>
              )
            })}
          </div>
        )}

        {panel === 'main' && (
          <div>
            <h3 className="font-semibold text-sm mb-2">{isOurOffense ? '一球結果（自チーム攻撃）' : '一球結果（相手チーム攻撃）'}</h3>
            <div className="grid grid-cols-2 gap-2 mb-3">
              {PITCH_RESULTS.map((p) => (
                <button key={p} onClick={() => selectPitch(p)} className={`py-3 px-2 rounded-lg border-2 text-sm font-semibold ${p === 'ヒッティング' ? 'bg-orange-50 border-orange-400 text-orange-800' : ['申告敬遠', 'デッドボール', '打撃妨害', 'ボーク'].includes(p) ? 'bg-blue-50 border-blue-400 text-blue-800' : 'bg-white border-gray-300 text-gray-900'}`}>{p}</button>
              ))}
            </div>

            {isOurOffense ? (
              <>
                <h3 className="font-semibold text-sm mb-2">選手交代</h3>
                <button onClick={() => setPanel('offense-sub')} className="w-full py-2 px-3 border-2 border-green-700 text-green-800 rounded-lg text-sm font-semibold mb-2">攻撃側交代</button>
                {runnerPlayers.length > 0 && (
                  <button onClick={() => setPanel('runner-sub')} className="w-full py-2 px-3 border-2 border-blue-600 text-blue-800 rounded-lg text-sm font-semibold mb-2">通常代走</button>
                )}
                {canTemporary && <button onClick={() => setPanel('temporary')} className="w-full py-2 px-3 bg-yellow-50 border-2 border-yellow-400 text-yellow-800 rounded-lg text-sm font-semibold mb-2">テンポラリー（臨時代走）</button>}
              </>
            ) : (
              <>
                <div className="bg-blue-50 border-2 border-blue-300 rounded-xl p-3 mb-3 text-sm text-blue-900">
                  相手チーム攻撃も同じ入力フローで記録できます。
                </div>
                <h3 className="font-semibold text-sm mb-2">選手交代</h3>
                <button onClick={() => setPanel('defense-sub')} className="w-full py-2 px-3 border-2 border-green-700 text-green-800 rounded-lg text-sm font-semibold mb-2">守備側交代</button>
              </>
            )}

            <div className="flex gap-2 mt-4">
              <button
                onClick={undoLastInput}
                disabled={undoStack.length === 0}
                className="flex-1 py-2 border-2 border-amber-500 text-amber-700 rounded-lg text-sm font-semibold disabled:opacity-50"
              >
                1つ戻す
              </button>
              <button
                onClick={undoTwoInputs}
                disabled={undoStack.length < 2}
                className="flex-1 py-2 border-2 border-amber-700 text-amber-900 rounded-lg text-sm font-semibold disabled:opacity-50"
              >
                2つ戻す
              </button>
              <Link href={`/games/${gameId}/finish?season=${seasonId}&team=${teamId}`} className="flex-1 py-2 bg-red-700 text-white rounded-lg text-sm font-semibold text-center">試合終了へ</Link>
            </div>
          </div>
        )}

        {panel === 'hitting' && (
          <div className="bg-orange-50 border-2 border-orange-300 rounded-xl p-4">
            <button onClick={() => setPanel('main')} className="text-xs text-green-700 mb-3">← 戻る</button>
            <h3 className="font-semibold text-sm mb-3">ポジション選択</h3>
            <div className="grid grid-cols-3 gap-2">{POSITIONS.map((pos) => <button key={pos} onClick={() => selectPosition(pos)} className="py-3 border-2 border-gray-300 bg-white rounded-lg text-sm font-bold text-gray-900">{pos}</button>)}</div>
          </div>
        )}

        {panel === 'result' && (
          <div className="bg-orange-50 border-2 border-orange-300 rounded-xl p-4">
            <button onClick={() => setPanel('hitting')} className="text-xs text-green-700 mb-3">← 戻る</button>
            <h3 className="font-semibold text-sm mb-3">打席結果（{selectedPos}方向）</h3>
            <div className="grid grid-cols-2 gap-2">{HIT_RESULTS.map((res) => <button key={res} onClick={() => selectResult(res)} className={`py-3 border-2 rounded-lg text-sm font-semibold ${['ヒット', '2B', '3B', 'HR', '走HR', 'エン2B'].includes(res) ? 'bg-orange-50 border-orange-400 text-orange-900' : 'bg-red-50 border-red-400 text-red-900'}`}>{res}</button>)}</div>
          </div>
        )}

        {panel === 'dp' && (
          <div className="bg-red-50 border-2 border-red-300 rounded-xl p-4">
            <button onClick={() => setPanel('result')} className="text-xs text-green-700 mb-3">← 戻る</button>
            <h3 className="font-semibold text-sm mb-3">追加（ランナーあり）</h3>
            <div className="grid grid-cols-1 gap-2">{['通常アウト', 'ダブルプレー', 'トリプルプレー'].map((t) => <button key={t} onClick={() => selectDP(t === '通常アウト' ? selectedResult : t === 'ダブルプレー' ? 'DP' : 'TP')} className="py-3 border-2 border-red-400 bg-white rounded-lg text-sm font-semibold text-red-900">{t}</button>)}</div>
          </div>
        )}

        {panel === 'error' && (
          <div className="bg-blue-50 border-2 border-blue-300 rounded-xl p-4">
            <h3 className="font-semibold text-sm mb-1">進塁・得点の確認</h3>
            <p className="text-xs text-gray-500 mb-3">一球: <strong>{selectedPitch}</strong></p>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={confirmAll} className="col-span-2 py-3 bg-green-700 text-white rounded-lg text-sm font-semibold">なし（そのまま確定）</button>
              <button onClick={() => startAdvanceFlow('advance')} className="py-3 border-2 border-gray-300 bg-white rounded-lg text-sm font-semibold text-gray-900">進塁あり</button>
              <button onClick={() => startAdvanceFlow('score')} className="py-3 border-2 border-gray-300 bg-white rounded-lg text-sm font-semibold text-gray-900">得点あり</button>
              <button onClick={() => startAdvanceFlow('both')} className="col-span-2 py-3 border-2 border-gray-300 bg-white rounded-lg text-sm font-semibold text-gray-900">進塁＋得点</button>
              <button onClick={() => setPanel('runner-out')} className="col-span-2 py-3 border-2 border-red-300 bg-red-50 rounded-lg text-sm font-semibold text-red-900">走者アウトあり</button>
            </div>
          </div>
        )}

        {panel === 'runner-out' && (
          <div className="bg-red-50 border-2 border-red-300 rounded-xl p-4">
            <button onClick={() => setPanel('error')} className="text-xs text-green-700 mb-3">← 戻る</button>
            <h3 className="font-semibold text-sm mb-3">走者アウト</h3>
            <label className="block text-xs text-gray-700 mb-1">アウトになった走者</label>
            <select
              value={outRunner}
              onChange={(e) => setOutRunner(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-4 text-gray-900"
            >
              <option value="">選択してください</option>
              {runnerPlayers.map(({ base, player, pid }) => (
                <option key={base} value={pid}>{base}: {player?.name}</option>
              ))}
            </select>
            <button onClick={confirmRunnerOut} disabled={!outRunner} className="w-full py-3 bg-red-700 text-white rounded-lg text-sm font-semibold disabled:opacity-50">
              アウトを確定
            </button>
          </div>
        )}

        {panel === 'reason' && (
          <div className="bg-blue-50 border-2 border-blue-300 rounded-xl p-4">
            <button onClick={() => setPanel('error')} className="text-xs text-green-700 mb-3">← 戻る</button>
            <h3 className="font-semibold text-sm mb-3">進塁・得点の理由</h3>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => selectReason('盗塁')} className="col-span-2 py-3 bg-indigo-50 border-2 border-indigo-400 rounded-lg text-sm font-bold text-indigo-900">盗塁</button>
              {ADVANCE_REASONS.filter((r) => r !== '盗塁').map((r) => <button key={r} onClick={() => selectReason(r)} className="py-3 border-2 border-gray-300 bg-white rounded-lg text-sm font-semibold text-gray-900">{r}</button>)}
            </div>
          </div>
        )}

        {panel === 'advance' && (
          <div className="bg-blue-50 border-2 border-blue-300 rounded-xl p-4">
            <button onClick={() => setPanel(advanceReason === 'ボーク' ? 'error' : 'reason')} className="text-xs text-green-700 mb-3">← 戻る</button>
            <h3 className="font-semibold text-sm mb-1">進塁詳細</h3>
            <p className="text-xs text-blue-700 bg-blue-100 rounded px-2 py-1 mb-3">理由: {advanceReason}</p>
            <label className="block text-xs text-gray-700 mb-1">対象ランナー</label>
            <select value={advanceRunner} onChange={(e) => setAdvanceRunner(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-3 text-gray-900">
              <option value="">選択してください</option>
              {runnerPlayers.map(({ base, player, pid }) => <option key={base} value={pid}>{base}: {player?.name}</option>)}
              <option value={activeBatterRunnerId || ''}>
                打者: {isOurOffense ? batterPlayer?.players?.name : '相手打者'}
              </option>
            </select>
            <label className="block text-xs text-gray-700 mb-1">進先</label>
            <select value={advanceTo} onChange={(e) => setAdvanceTo(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-4 text-gray-900">
              <option value="">選択してください</option>
              {BASES.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
            <button onClick={confirmAdvance} className="w-full py-3 bg-green-700 text-white rounded-lg text-sm font-semibold">確定</button>
          </div>
        )}

        {panel === 'score' && (
          <div className="bg-blue-50 border-2 border-blue-300 rounded-xl p-4">
            <button onClick={() => setPanel(advanceKind === 'both' ? 'advance' : 'reason')} className="text-xs text-green-700 mb-3">← 戻る</button>
            <h3 className="font-semibold text-sm mb-3">得点ランナー（複数可）</h3>
            {runnerPlayers.map(({ base, player, pid }) => (
              <label key={base} className="flex items-center gap-2 mb-2 text-sm text-gray-900">
                <input type="checkbox" checked={scoreRunners.includes(pid)} onChange={(e) => setScoreRunners((prev) => (e.target.checked ? [...prev, pid] : prev.filter((x) => x !== pid)))} className="w-4 h-4 accent-green-700" />
                {base}: {player?.name}
              </label>
            ))}
            <button onClick={confirmScore} className="w-full mt-3 py-3 bg-green-700 text-white rounded-lg text-sm font-semibold">確定</button>
          </div>
        )}

        {panel === 'offense-sub' && (
          <div className="bg-green-50 border-2 border-green-400 rounded-xl p-4">
            <button onClick={() => { setSubTarget(null); setPanel('main') }} className="text-xs text-green-700 mb-3">← 戻る</button>
            <h3 className="font-semibold text-sm mb-3">攻撃側選手交代</h3>
            {subTarget === null ? (
              <div className="flex flex-col gap-2">
                {starters.map((s, i) => {
                  const p = lineup.find((l) => l.player_id === s.playerId)
                  return <button key={s.playerId} onClick={() => setSubTarget(i)} className="flex items-center justify-between px-4 py-3 bg-white border-2 border-gray-200 rounded-lg text-sm"><span><strong>{s.battingOrder}番</strong> {p?.players?.name}</span><span className="text-xs text-gray-400">{s.position}</span></button>
                })}
              </div>
            ) : (
              <>
                {benchPlayers.length === 0 ? <p className="text-sm text-gray-500 py-4 text-center">交代できる選手がいません</p> : <div className="flex flex-col gap-2">{benchPlayers.map((p) => <button key={p.player_id} onClick={() => executeSubstitution(p.player_id)} className="flex items-center justify-between px-4 py-3 bg-white border-2 border-green-300 rounded-lg text-sm"><span><strong>#{p.players?.number}</strong> {p.players?.name}</span><span className="text-xs text-gray-500">{benchedStarters.has(p.player_id) ? '再出場' : '控え'}</span></button>)}</div>}
                <button onClick={() => setSubTarget(null)} className="mt-3 text-xs text-gray-500 underline">← 選び直す</button>
              </>
            )}
          </div>
        )}

        {panel === 'defense-sub' && (
          <div className="bg-green-50 border-2 border-green-400 rounded-xl p-4">
            <button onClick={() => { setDefenseSubTarget(null); setDefenseSubPosition(''); setPanel('main') }} className="text-xs text-green-700 mb-3">← 戻る</button>
            <h3 className="font-semibold text-sm mb-3">守備側選手交代</h3>
            {defenseSubTarget === null ? (
              <>
                <p className="text-xs text-gray-600 mb-2">交代する守備位置を選択してください</p>
                <div className="flex flex-col gap-2">
                  {POSITIONS.map((pos) => {
                    const defenderId = getDefenderIdByPosition(pos)
                    const p = lineup.find((l) => l.player_id === defenderId)
                    const isFp = dhFpPairs.some((pair) => pair.fpPlayerId === defenderId && pair.fpPosition === pos)
                    return (
                      <button
                        key={`${pos}-${defenderId}`}
                        onClick={() => {
                          if (!defenderId) return
                          setDefenseSubTarget(defenderId)
                          setDefenseSubPosition(pos)
                        }}
                        disabled={!defenderId}
                        className="flex items-center justify-between px-4 py-3 bg-white border-2 border-gray-200 rounded-lg text-sm disabled:opacity-50"
                      >
                        <span>{pos}: {p?.players?.name || '未設定'}</span>
                        <span className="text-xs text-gray-400">{defenderId ? (isFp ? 'FP' : '守備') : '未設定'}</span>
                      </button>
                    )
                  })}
                </div>
              </>
            ) : (
              <>
                <p className="text-xs text-gray-600 mb-1">入る選手を選択してください</p>
                <label className="block text-xs text-gray-700 mb-1 mt-2">投入先ポジション</label>
                <select
                  value={defenseSubPosition}
                  onChange={(e) => setDefenseSubPosition(e.target.value)}
                  className="w-full border border-gray-300 rounded px-2 py-2 text-xs mb-3"
                >
                  <option value="">選択してください</option>
                  {POSITIONS.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
                {benchPlayers.length === 0 ? (
                  <p className="text-sm text-gray-500 py-4 text-center">交代できる選手がいません</p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {benchPlayers.map((p) => (
                      <button
                        key={p.player_id}
                        onClick={() => executeDefenseSubstitution(p.player_id, defenseSubPosition)}
                        disabled={!defenseSubPosition}
                        className="flex items-center justify-between px-4 py-3 bg-white border-2 border-green-300 rounded-lg text-sm disabled:opacity-50"
                      >
                        <span><strong>#{p.players?.number}</strong> {p.players?.name}</span>
                        <span className="text-xs text-gray-500">{benchedStarters.has(p.player_id) ? '再出場' : '控え'}</span>
                      </button>
                    ))}
                  </div>
                )}
                <button onClick={() => { setDefenseSubTarget(null); setDefenseSubPosition('') }} className="mt-3 text-xs text-gray-500 underline">← 守備位置を選び直す</button>
              </>
            )}
          </div>
        )}

        {panel === 'runner-sub' && (
          <div className="bg-blue-50 border-2 border-blue-400 rounded-xl p-4">
            <button
              onClick={() => {
                setRunnerSubTargetBase('')
                setRunnerSubTargetPlayerId('')
                setPanel('main')
              }}
              className="text-xs text-green-700 mb-3"
            >
              ← 戻る
            </button>
            <h3 className="font-semibold text-sm mb-3">通常代走</h3>

            {!runnerSubTargetBase ? (
              <>
                <p className="text-xs text-gray-600 mb-2">代走を出す走者を選択してください</p>
                <div className="flex flex-col gap-2">
                  {runnerPlayers.map(({ base, player, pid }) => (
                    <button
                      key={base}
                      onClick={() => {
                        setRunnerSubTargetBase(base)
                        setRunnerSubTargetPlayerId(pid)
                      }}
                      className="flex items-center justify-between px-4 py-3 bg-white border-2 border-gray-200 rounded-lg text-sm"
                    >
                      <span>{base}: {player?.name}</span>
                      <span className="text-xs text-gray-400">走者</span>
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <>
                <p className="text-xs text-gray-600 mb-1">代走を選択してください</p>
                <p className="text-xs bg-blue-100 border border-blue-200 rounded px-2 py-1 mb-3">
                  対象: {runnerSubTargetBase}
                </p>
                {benchPlayers.length === 0 ? (
                  <p className="text-sm text-gray-500 py-4 text-center">交代できる選手がいません</p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {benchPlayers.map((p) => (
                      <button
                        key={p.player_id}
                        onClick={() => executeRunnerSub(p.player_id)}
                        className="flex items-center justify-between px-4 py-3 bg-white border-2 border-blue-300 rounded-lg text-sm"
                      >
                        <span><strong>#{p.players?.number}</strong> {p.players?.name}</span>
                        <span className="text-xs text-gray-500">{benchedStarters.has(p.player_id) ? '再出場' : '控え'}</span>
                      </button>
                    ))}
                  </div>
                )}
                <button
                  onClick={() => {
                    setRunnerSubTargetBase('')
                    setRunnerSubTargetPlayerId('')
                  }}
                  className="mt-3 text-xs text-gray-500 underline"
                >
                  ← 走者を選び直す
                </button>
              </>
            )}
          </div>
        )}

        {panel === 'temporary' && (
          <div className="bg-yellow-50 border-2 border-yellow-400 rounded-xl p-4">
            <button onClick={() => setPanel('main')} className="text-xs text-green-700 mb-3">← 戻る</button>
            <h3 className="font-semibold text-sm mb-2">テンポラリー（臨時代走）</h3>
            {(() => {
              const c = getTemporaryCandidate()
              return c ? (
                <div>
                  <div className="bg-white border border-yellow-300 rounded-lg p-3 mb-4">
                    <p className="font-bold text-base text-gray-900">{c.players?.name} #{c.players?.number}</p>
                  </div>
                  <button onClick={confirmTemporary} className="w-full py-3 bg-green-700 text-white rounded-lg text-sm font-semibold">代走を確定</button>
                </div>
              ) : <p className="text-sm text-gray-500">候補選手がいません</p>
            })()}
          </div>
        )}
      </div>
    </div>
  )
}

export default function RecordPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-screen"><p className="text-gray-500">読み込み中...</p></div>}>
      <RecordContent />
    </Suspense>
  )
}
