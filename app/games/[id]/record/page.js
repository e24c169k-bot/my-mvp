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
  const [opponentRunnerSeq, setOpponentRunnerSeq] = useState(1)
  const [activeBatterRunnerId, setActiveBatterRunnerId] = useState('')
  const halfSwitchingRef = useRef(false)

  const [activeBatters, setActiveBatters] = useState([])
  const [reentryUsed, setReentryUsed] = useState(new Set())
  const [benchedStarters, setBenchedStarters] = useState(new Set())
  const [subTarget, setSubTarget] = useState(null)
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
  const teamPitcher = lineup.find((l) => l.player_id === pitcherId)
  const catcherEntry = lineup.find((l) => l.position === 'C')
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

    const pitcherEntry = normalizedLineup.find((x) => x.position === 'P')
    if (pitcherEntry) setPitcherId(pitcherEntry.player_id)

    const state = g?.state_json || {}
    setInning(state.inning || 1)
    setInningHalf(state.inningHalf || 'top')
    setUsBattingTurn(state.usBattingTurn || 'first')
    setBalls(state.balls || 0)
    setStrikes(state.strikes || 0)
    setOuts(state.outs || 0)
    setRunners(state.runners || { '1塁': null, '2塁': null, '3塁': null })
    setBatterIndex(state.batterIndex || 0)
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
      batterIndex: next.batterIndex ?? batterIndex
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

  const activePlayerIds = new Set(starters.map((s) => s.playerId))
  const benchPlayers = lineup.filter((l) => {
    if (activePlayerIds.has(l.player_id)) return false
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
    setPanel('main')
    setSubTarget(null)
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

  const hasRunnerP = teamPitcher && Object.values(runners).some((r) => r === pitcherId)
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
        pitcher_id: isOurOffense ? null : pitcherId || null,
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
    const { error } = await supabase.from('plate_appearances').insert({
      game_id: gameId,
      team_id: teamId,
      player_id: batter?.playerId || null,
      inning,
      result,
      position_hit_to: positionHitTo || null
    })
    if (error) setErrorMsg(error.message)
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
    setSelectedPitch(pitch)
    setErrorMsg('')
    setActiveBatterRunnerId('')
    if (pitch === 'ヒッティング') {
      setPanel('hitting')
      return
    }
    if (pitch === 'ボーク') {
      setAdvanceReason('ボーク')
      await savePitch(pitch, 'ボーク', 'ボーク')
      setPanel('error')
      return
    }

    if (['見逃しS', '空振りS', 'バント空振'].includes(pitch)) {
      const newS = strikes + 1
      if (newS >= 3) {
        await savePitch(pitch, '三振', null)
        await savePA('三振', null)
        const newOuts = outs + 1
        const nextIndex = nextBatter()
        setOuts(newOuts)
        persistGameState({ outs: newOuts, balls: 0, strikes: 0, batterIndex: nextIndex })
      } else {
        setStrikes(newS)
        await savePitch(pitch, null, null)
        persistGameState({ strikes: newS })
      }
      setPanel('error')
      return
    }

    if (pitch === 'ボール') {
      const newB = balls + 1
      if (newB >= 3) {
        await savePitch(pitch, '四球', null)
        await savePA('四球', null)
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
        await savePitch(pitch, null, null)
        persistGameState({ balls: newB })
      }
      setPanel('error')
      return
    }

    if (['申告敬遠', 'デッドボール', '打撃妨害'].includes(pitch)) {
      await savePitch(pitch, pitch, null)
      await savePA(pitch, null)
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
      return
    }

    if (pitch === 'ファウル' || pitch === 'バントF') {
      const nextStrikes = strikes < 2 ? strikes + 1 : strikes
      setStrikes(nextStrikes)
      await savePitch(pitch, null, null)
      persistGameState({ strikes: nextStrikes })
      setPanel('error')
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
    await savePitch('ヒッティング', finalRes, null)
    await savePA(finalRes, selectedPos)

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
      if (res === 'ヒット') nextRunners['1塁'] = batterRunnerId
      else if (res === '2B' || res === 'エン2B') nextRunners['2塁'] = batterRunnerId
      else if (res === '3B') nextRunners['3塁'] = batterRunnerId
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
    }
    setPanel('error')
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
    if (!advanceRunner || !advanceTo) {
      if (advanceKind === 'both') setPanel('score')
      else confirmAll()
      return
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
      await supabase.from('runner_advances').insert({
        pitch_id: lastPitchId,
        team_id: teamId,
        runner_id: advanceRunner,
        from_base: null,
        to_base: advanceTo,
        reason: advanceReason || 'その他'
      })
    }
    if (advanceKind === 'both') setPanel('score')
    else confirmAll()
  }

  async function confirmScore() {
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
        await supabase.from('runner_advances').insert({
          pitch_id: lastPitchId,
          team_id: teamId,
          runner_id: runnerId,
          from_base: null,
          to_base: '本塁',
          reason: advanceReason || 'その他'
        })
      }
    }
    confirmAll()
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
    setScoreRunners([])
    setActiveBatterRunnerId('')
  }

  function confirmTemporary() {
    const candidate = getTemporaryCandidate()
    if (!candidate) return
    const targetBase = hasRunnerP
      ? Object.keys(runners).find((b) => runners[b] === pitcherId)
      : Object.keys(runners).find((b) => runners[b] === catcherEntry?.player_id)
    if (!targetBase) return
    const nextRunners = { ...runners, [targetBase]: candidate.playerId }
    setRunners(nextRunners)
    persistGameState({ runners: nextRunners })
    setPanel('main')
  }

  async function addOpponentScore() {
    const nextScoreThem = scoreThem + 1
    setScoreThem(nextScoreThem)
    await persistGameState({ scoreThem: nextScoreThem })
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
              <div className="font-bold">{isOurOffense ? '未入力' : teamPitcher?.players?.name || '未入力'}</div>
            </div>
          </div>

          <div className="flex justify-center gap-6 bg-black/30 rounded-lg py-2 px-4 mb-3">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-bold text-white/80">B</span>
              <div className="flex gap-1">{[0, 1, 2].map((i) => <div key={i} className={`w-3.5 h-3.5 rounded-full border-2 ${i < balls ? 'bg-green-400 border-green-300' : 'border-white/40'}`} />)}</div>
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
              <div className="bg-blue-50 border-2 border-blue-300 rounded-xl p-3 mb-3 text-sm text-blue-900">
                相手チーム攻撃も同じ入力フローで記録できます。
              </div>
            )}

            <div className="flex gap-2 mt-4">
              <button onClick={addOpponentScore} className="flex-1 py-2 border-2 border-gray-300 rounded-lg text-sm text-gray-700">相手 ＋1点</button>
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
            </div>
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
