import { describe, expect, it } from 'vitest'
import { parsePhotoRead, photoMediaType } from './photo-text'

describe('what the API will take', () => {
  it('trusts the stored mime, then the name', () => {
    expect(photoMediaType('image/jpeg', null, 'a/b')).toBe('image/jpeg')
    // checklist_photos store no mime at all; the name is all there is.
    expect(photoMediaType(null, '0212e547.jpg', 'a/b')).toBe('image/jpeg')
    expect(photoMediaType(null, null, 'photos/x.PNG')).toBe('image/png')
    expect(photoMediaType('image/jpeg; charset=binary', null, 'a/b')).toBe('image/jpeg')
  })

  it('says no to a format the Messages API cannot read', () => {
    // A HEIC straight off an iPhone. Sending it would fail every night.
    expect(photoMediaType('image/heic', 'IMG_1234.HEIC', 'a/b')).toBeNull()
    expect(photoMediaType(null, 'scan.tif', 'a/b')).toBeNull()
  })
})

describe('reading the reply', () => {
  it('takes the fields it asked for and ignores the rest', () => {
    const r = parsePhotoRead('Here you go: {"text":"BX265836","caption":"A motor plate.","kind":"nameplate","unsure":false,"extra":1}')
    expect(r).toEqual({ text: 'BX265836', caption: 'A motor plate.', kind: 'nameplate', unsure: false })
  })

  it('keeps an empty read, which is a real answer', () => {
    // A photo of a field with nothing written in it: text "" and a caption.
    const r = parsePhotoRead('{"text":"","caption":"Stubble to the horizon.","kind":"scene","unsure":false}')
    expect(r?.text).toBe('')
    expect(r?.caption).toBe('Stubble to the horizon.')
  })

  it('falls back to other for a kind it did not offer', () => {
    expect(parsePhotoRead('{"text":"x","caption":"","kind":"photograph","unsure":false}')?.kind).toBe('other')
  })

  it('returns null for a reply that is not the shape asked for', () => {
    // Null, not an empty read: the row stays unread and is tried again, rather
    // than being recorded as a photo with no writing in it.
    expect(parsePhotoRead('I cannot help with that.')).toBeNull()
    expect(parsePhotoRead('{"text": unquoted}')).toBeNull()
    expect(parsePhotoRead('{"kind":"scene"}')).toBeNull()
  })
})
