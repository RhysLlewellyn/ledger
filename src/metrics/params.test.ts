import {describe, expect, it} from 'vitest'

import {activeFilterCount, customerHref, DEFAULTS, parseCustomerParams} from './params.ts'

/**
 * The URL contract, asserted in both directions.
 *
 * No database. This file is pure string handling, and it is the part of the
 * dashboard most exposed to whatever somebody types into an address bar — so
 * the tests that matter most here are the ones that feed it rubbish and check
 * that it produces a working page rather than an exception.
 */

describe('parsing', () => {
  it('falls back to defaults when nothing is given', () => {
    expect(parseCustomerParams({})).toMatchObject({
      sort: DEFAULTS.sort,
      direction: DEFAULTS.direction,
      page: 1,
      perPage: 50,
    })
  })

  it('reads a filtered, sorted, paginated view', () => {
    const options = parseCustomerParams({
      sort: 'name',
      dir: 'asc',
      page: '4',
      plan: ['team', 'business'],
      status: 'active',
      country: ['GB', 'DE'],
      channel: 'outbound',
      from: '2025-01-01',
      to: '2025-12-31',
      mrrMin: '250',
      mrrMax: '5000',
    })

    expect(options).toMatchObject({
      sort: 'name',
      direction: 'asc',
      page: 4,
      plans: ['team', 'business'],
      statuses: ['active'],
      countries: ['GB', 'DE'],
      channels: ['outbound'],
      signedUpFrom: '2025-01-01',
      signedUpTo: '2025-12-31',
      // Pounds in the URL, pence in the query. One conversion, in one place.
      mrrMinPence: 25_000,
      mrrMaxPence: 500_000,
    })
  })

  it.each([
    ['an unknown sort column', {sort: 'DROP TABLE customer'}],
    ['a nonsense direction', {dir: 'sideways'}],
    ['a negative page', {page: '-3'}],
    ['a fractional page', {page: '2.5'}],
    ['a page beyond any dataset', {page: '99999999999'}],
    ['a malformed date', {from: '01/02/2025'}],
    ['an impossible date', {from: '2025-13-45'}],
    ['a non-numeric money bound', {mrrMin: 'lots'}],
    ['a negative money bound', {mrrMin: '-100'}],
    ['an infinite money bound', {mrrMin: 'Infinity'}],
    ['a status that is not a status', {status: 'dormant'}],
    ['a country that is not a country code', {country: 'United Kingdom'}],
    ['a channel that is not a channel', {channel: 'telepathy'}],
  ])('survives %s', (_label, raw) => {
    // The worst a hand-typed URL can do is show the first page of an
    // unfiltered table. Never a 500, never a redirect loop.
    const options = parseCustomerParams(raw)
    expect(options.sort).toBe(DEFAULTS.sort)
    expect(options.page).toBeGreaterThanOrEqual(1)
    expect(activeFilterCount(options)).toBe(0)
  })

  it('keeps a valid filter when an invalid one sits beside it', () => {
    const options = parseCustomerParams({country: ['GB', 'nonsense'], status: 'active'})
    expect(options.countries).toEqual(['GB'])
    expect(options.statuses).toEqual(['active'])
  })

  it('deduplicates a repeated value', () => {
    expect(parseCustomerParams({plan: ['team', 'team']}).plans).toEqual(['team'])
  })
})

describe('serialising', () => {
  it('leaves defaults out of the URL', () => {
    const options = parseCustomerParams({})
    // `/customers` and `/customers?page=1&sort=mrr&dir=desc` are the same
    // view, and only one of them is worth putting in front of somebody.
    expect(customerHref(options)).toBe('')
  })

  it('round-trips a complex view', () => {
    const original = parseCustomerParams({
      sort: 'seats',
      dir: 'asc',
      page: '7',
      plan: ['enterprise'],
      country: ['GB'],
      from: '2025-06-01',
      mrrMax: '1200',
    })
    const href = customerHref(original)
    const parsed = parseCustomerParams(Object.fromEntries(new URLSearchParams(href.slice(1))))

    expect(parsed).toEqual(original)
  })

  it('returns to page one when a filter changes', () => {
    const onPageTwelve = parseCustomerParams({page: '12'})
    const href = customerHref(onPageTwelve, {countries: ['GB']})
    // Landing on page twelve of three results is the oldest bug in faceted
    // search, and the fix belongs here rather than in every caller.
    expect(href).not.toContain('page=')
    expect(href).toContain('country=GB')
  })

  it('returns to page one when the sort changes', () => {
    const href = customerHref(parseCustomerParams({page: '5'}), {sort: 'name'})
    expect(href).not.toContain('page=')
  })

  it('keeps the page when only the page changes', () => {
    const href = customerHref(parseCustomerParams({country: 'GB'}), {page: 3})
    expect(href).toContain('page=3')
    expect(href).toContain('country=GB')
  })

  it('clamps an absurd money bound instead of dropping it', () => {
    // Dropping it would show every customer while the URL still claimed a
    // filter was applied. Clamping answers the question that was asked.
    const options = parseCustomerParams({mrrMin: '99999999'})
    expect(options.mrrMinPence).toBe(1_000_000_000)
    expect(activeFilterCount(options)).toBe(1)
  })

  it('round-trips money through pounds without drifting', () => {
    const options = parseCustomerParams({mrrMin: '1234.56'})
    expect(options.mrrMinPence).toBe(123_456)
    expect(customerHref(options)).toContain('mrrMin=1234.56')
  })
})

describe('counting what is active', () => {
  it('is zero for an unfiltered view whatever the sort and page', () => {
    expect(activeFilterCount(parseCustomerParams({sort: 'name', page: '9'}))).toBe(0)
  })

  it('counts each applied filter once', () => {
    const options = parseCustomerParams({
      plan: ['team', 'business'],
      status: 'active',
      from: '2025-01-01',
      mrrMin: '100',
    })
    expect(activeFilterCount(options)).toBe(5)
  })
})

describe('search and page size', () => {
  it('trims a search term and drops an empty one', () => {
    expect(parseCustomerParams({q: '  quarry  '}).query).toBe('quarry')
    expect(parseCustomerParams({q: '   '}).query).toBeUndefined()
    expect(parseCustomerParams({q: ''}).query).toBeUndefined()
  })

  it('caps a search term rather than sending an essay to Postgres', () => {
    const long = 'a'.repeat(500)
    expect(parseCustomerParams({q: long}).query).toHaveLength(60)
  })

  it('keeps wildcards as characters, because they are matched literally', () => {
    // The term is a bound parameter, so % and _ are not pattern syntax. If
    // that ever changes, "%" alone would silently match every customer.
    expect(parseCustomerParams({q: '100%_off'}).query).toBe('100%_off')
  })

  it('round-trips a search term through the URL', () => {
    const options = parseCustomerParams({q: 'quarry works'})
    expect(customerHref(options)).toBe('?q=quarry+works')
    expect(parseCustomerParams({q: 'quarry works'}).query).toBe(
      parseCustomerParams(Object.fromEntries(new URLSearchParams('q=quarry+works'))).query,
    )
  })

  it('accepts only the page sizes it offers', () => {
    expect(parseCustomerParams({perPage: '25'}).perPage).toBe(25)
    expect(parseCustomerParams({perPage: '200'}).perPage).toBe(200)
    for (const junk of ['99999', '0', '-50', '12', 'all', '', '1e6']) {
      expect(parseCustomerParams({perPage: junk}).perPage).toBe(DEFAULTS.perPage)
    }
  })

  it('leaves the default page size out of the URL', () => {
    expect(customerHref(parseCustomerParams({perPage: '50'}))).toBe('')
    expect(customerHref(parseCustomerParams({perPage: '200'}))).toBe('?perPage=200')
  })

  it('counts a search as an applied filter', () => {
    expect(activeFilterCount(parseCustomerParams({}))).toBe(0)
    expect(activeFilterCount(parseCustomerParams({q: 'quarry'}))).toBe(1)
    expect(activeFilterCount(parseCustomerParams({q: 'quarry', country: 'GB'}))).toBe(2)
  })

  it('resets to page one when the search changes', () => {
    const onPageTwelve = parseCustomerParams({page: '12', q: 'works'})
    expect(customerHref(onPageTwelve, {query: 'quarry'})).not.toContain('page=')
  })
})
