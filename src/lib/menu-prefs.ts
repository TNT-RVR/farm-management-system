import { useMemo, useSyncExternalStore } from 'react'
import { useLocation } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import { hasAdminAccess, hasManagerAccess, useAuth, type AppRole } from './auth'
import { isViewDenied, resolveNav, type NavPrefs } from './nav'
import { isPathOff, useDisabledPaths } from './farm-setup'
import {
  MENU_SECTIONS,
  carryOverHidden,
  filterSections,
  matchLocation,
  menuEnabled,
  readMenuPrefs,
  withCarriedHidden,
  resolveBar,
  resolveMenu,
  type MenuAccess,
  type MenuDevice,
  type MenuPrefs,
} from './nav-tree'

/*
 * The season menu's hooks: a person's menu_prefs, what they may see, and the
 * menu resolved for the device in hand. The tree and the pure rules are in
 * lib/nav-tree.ts.
 *
 * The season menu is everyone's menu since 26 Oct 2026 (Sam); the old one
 * (lib/nav.ts) is what you get only by choosing it, and is going away later.
 */

// The app's md breakpoint. A tablet turned sideways is wider than this and
// gets the desktop menu, which is what it has room for.
const DESKTOP_QUERY = '(min-width: 768px)'

function subscribeWidth(cb: () => void) {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {}
  const mq = window.matchMedia(DESKTOP_QUERY)
  mq.addEventListener('change', cb)
  return () => mq.removeEventListener('change', cb)
}
const desktopNow = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(DESKTOP_QUERY).matches : true)

/** Which device's menu this screen gets, by width. */
export function useMenuDevice(): MenuDevice {
  return useSyncExternalStore(subscribeWidth, desktopNow, () => true) ? 'desktop' : 'phone'
}

/**
 * The person's menu_prefs, read defensively, with what they hid in the old
 * menu filled in where they have not set the new one (Sam, 26 Oct 2026).
 * Everything reads prefs through here, the Menu panel included, so what it
 * shows is what the menu does, and its first save writes the carried list down.
 */
export function useMenuPrefs(): MenuPrefs {
  const { profile } = useAuth()
  const raw = profile?.menu_prefs
  const nav = profile?.nav_prefs
  return useMemo(() => {
    const prefs = readMenuPrefs(raw)
    if (prefs.desktop?.hidden && prefs.phone?.hidden) return prefs
    const old = nav as NavPrefs | null | undefined
    const savedHidden = Array.isArray(old?.hidden) ? old.hidden.filter((k): k is string => typeof k === 'string') : []
    return withCarriedHidden(prefs, carryOverHidden(resolveNav(old), savedHidden))
  }, [raw, nav])
}

/**
 * Season menu or old menu: the one place that decides. On for everyone unless
 * they chose the old menu in Settings → My account → Menu (Sam, 26 Oct 2026).
 */
export function useMenuEnabled(): boolean {
  return menuEnabled(useMenuPrefs())
}

/**
 * What a person may open at all: not denied by an admin, not a part of the
 * app the farm switched off, and their role is enough. Same rules as the old
 * sidebar. A denial is matched on the path without its `?tab=`, so denying
 * /plan also takes Crop money and Next year's plan (/plan?tab=…) wherever
 * they are listed, shortcuts included.
 */
export function menuAccess(
  profile: { role?: AppRole; denied_views?: string[] | null } | null | undefined,
  off: string[],
): MenuAccess {
  return ({ to, access }) => {
    const path = to.split('?')[0]
    // The full link for the switches: a feature can be one tab of a page.
    if (isViewDenied(profile, path) || isPathOff(off, to)) return false
    if (access === 'admin') return hasAdminAccess(profile?.role)
    if (access === 'manager') return hasManagerAccess(profile?.role)
    return true
  }
}

export function useMenuAccess(): MenuAccess {
  const { profile } = useAuth()
  const off = useDisabledPaths()
  return useMemo(() => menuAccess(profile, off), [profile, off])
}

/** The menu for one device: allowed tree, their order and hiding, and the phone bar. */
export function useMenu(device: MenuDevice) {
  const prefs = useMenuPrefs()
  const canSee = useMenuAccess()
  return useMemo(() => {
    const allowed = filterSections(MENU_SECTIONS, canSee)
    const devicePrefs = device === 'desktop' ? prefs.desktop : prefs.phone
    const resolved = resolveMenu(allowed, devicePrefs)
    return {
      ...resolved,
      /** Everything they may open, ignoring their own hiding: for "All views" and the settings list. */
      allowed,
      hidden: new Set(devicePrefs?.hidden ?? []),
      bar: resolveBar(resolved, prefs.phone?.buttons),
      canSee,
    }
  }, [prefs, canSee, device])
}

/** Where the current address sits in the menu. */
export function useMenuMatch() {
  const { pathname, search } = useLocation()
  return useMemo(() => matchLocation(pathname, search), [pathname, search])
}

/** Persist menu_prefs to the user's row, optimistically, like useSaveNavPrefs. */
export function useSaveMenuPrefs() {
  const { profile } = useAuth()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (prefs: MenuPrefs) => {
      if (!profile) throw new Error('Not signed in')
      const { error } = await supabase.from('users').update({ menu_prefs: prefs }).eq('id', profile.id)
      if (error) throw error
      return prefs
    },
    // The menu changes the moment a switch is flipped, not a round trip later.
    onMutate: async (prefs) => {
      const key = ['profile', profile?.id]
      await queryClient.cancelQueries({ queryKey: key })
      const prev = queryClient.getQueryData(key)
      queryClient.setQueryData(key, (old: unknown) => (old ? { ...(old as object), menu_prefs: prefs } : old))
      return { prev, key }
    },
    onError: (_e, _prefs, ctx) => {
      if (ctx) queryClient.setQueryData(ctx.key, ctx.prev)
    },
  })
}
