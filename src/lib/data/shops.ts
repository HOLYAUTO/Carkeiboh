/** 整備工場（掲載店）と、送客の記録 */
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth';
import { unwrap } from '../db';
import { supabase } from '../supabase';

export interface ShopRow {
  id: string;
  name: string;
  address: string;
  phone: string | null;
  latitude: number;
  longitude: number;
  business_hours: string | null;
  description: string | null;
  website_url: string | null;
  services: string[];
  display_priority: number;
}

/** 掲載中の整備工場（掲載期間外・非公開の店舗は RLS で返らない） */
export function useShops() {
  const { session } = useAuth();
  const userId = session?.user.id;
  return useQuery({
    queryKey: ['shops', userId],
    enabled: !!userId,
    staleTime: 10 * 60_000,
    queryFn: async () =>
      unwrap(
        await supabase
          .from('shops')
          .select('id, name, address, phone, latitude, longitude, business_hours, description, website_url, services, display_priority')
          .order('name'),
      ) as ShopRow[],
  });
}

export type ShopAction = 'view' | 'route' | 'call' | 'website';

/** 送客の記録（掲載店への報告に使う）。記録できなくても利用者の操作は止めない */
export function logShopAction(shopId: string, action: ShopAction) {
  supabase
    .from('shop_referrals')
    .insert({ shop_id: shopId, action })
    .then(({ error }) => {
      if (error) console.warn('送客の記録に失敗しました', error.message);
    });
}
