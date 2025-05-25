import NotionDocumentService from './service';
import { NotionUserContent, NotionRepository } from './types';
import { ICookieService } from '@/service/common/cookie';
import { IWebRequestService } from '@/service/common/webRequest';
import Container from 'typedi';
import axios from 'axios';

// Mock axios and its methods
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;
mockedAxios.create = jest.fn(() => mockedAxios);

// Mock dependent services
const mockCookieService: jest.Mocked<ICookieService> = {
  getAll: jest.fn().mockResolvedValue([]),
  set: jest.fn().mockResolvedValue(undefined as any),
  remove: jest.fn().mockResolvedValue(undefined as any),
  onChanged: {
    addListener: jest.fn(),
    removeListener: jest.fn(),
    hasListener: jest.fn(),
  } as any,
};

const mockWebRequestService: jest.Mocked<IWebRequestService> = {
  startChangeHeader: jest.fn().mockResolvedValue('header_id'),
  end: jest.fn().mockResolvedValue(undefined),
  changeUrl: jest.fn((url) => Promise.resolve(url)),
};

// Set mocks in the container
Container.set(ICookieService, mockCookieService);
Container.set(IWebRequestService, mockWebRequestService);

describe('NotionDocumentService', () => {
  let notionService: NotionDocumentService;

  beforeEach(() => {
    // Reset mocks before each test
    jest.clearAllMocks();
    notionService = new NotionDocumentService();
  });

  describe('getRepositories', () => {
    it('should return an empty array if recordMap.space is null', async () => {
      const mockUserContentWithNullSpace = {
        recordMap: {
          space: null,
          notion_user: { 'user_id_1': { value: { id: 'user_id_1', email: 'test@example.com', profile_photo: 'url', name: 'Test User', given_name: '', family_name: '', version: 0 } } },
        },
      } as unknown as NotionUserContent;

      // @ts-ignore Allow access to private method for testing and mock it
      const getUserContentMock = jest.fn().mockResolvedValue(mockUserContentWithNullSpace);
      notionService['getUserContent'] = getUserContentMock;
      
      const repositories = await notionService.getRepositories();
      
      expect(repositories).toEqual([]);
      expect(getUserContentMock).toHaveBeenCalledTimes(1);
    });

    it('should return an empty array if a space.value is null within the map', async () => {
      const mockUserContentWithNullSpaceValue = {
        recordMap: {
          space: {
            'space_id_1': { value: null } 
          },
          notion_user: { 'user_id_1': { value: { id: 'user_id_1', email: 'test@example.com', profile_photo: 'url', name: 'Test User', given_name: '', family_name: '', version: 0 } } },
        },
      } as unknown as NotionUserContent;

      // @ts-ignore
      const getUserContentMock = jest.fn().mockResolvedValue(mockUserContentWithNullSpaceValue);
      notionService['getUserContent'] = getUserContentMock;
      
      // Mock getRecentPageVisits as it's called within the loop
      // @ts-ignore
      const getRecentPageVisitsMock = jest.fn().mockResolvedValue({ recordMap: { collection: {} } });
      notionService['getRecentPageVisits'] = getRecentPageVisitsMock;

      const repositories = await notionService.getRepositories();
      
      expect(repositories).toEqual([]);
      expect(getUserContentMock).toHaveBeenCalledTimes(1);
      // getRecentPageVisits should not be called if space.value is null
      expect(getRecentPageVisitsMock).not.toHaveBeenCalled(); 
    });

    it('should return an empty array if spaces object is empty', async () => {
        const mockUserContentWithEmptySpaces = {
          recordMap: {
            space: {}, // Empty space object
            notion_user: { 'user_id_1': { value: { id: 'user_id_1', email: 'test@example.com', profile_photo: 'url', name: 'Test User', given_name: '', family_name: '', version: 0 } } },
          },
        } as unknown as NotionUserContent;
  
        // @ts-ignore
        const getUserContentMock = jest.fn().mockResolvedValue(mockUserContentWithEmptySpaces);
        notionService['getUserContent'] = getUserContentMock;
  
        const repositories = await notionService.getRepositories();
        expect(repositories).toEqual([]);
        expect(getUserContentMock).toHaveBeenCalledTimes(1);
      });

    it('should correctly map and return repositories when space data is valid', async () => {
      const mockUserContentValid = {
        recordMap: {
          space: {
            'space_id_1': { value: { id: 'space_id_1', name: 'Space 1', permissions: [], plan_type: 'personal', beta_features: [] } },
            'space_id_2': { value: { id: 'space_id_2', name: 'Space 2', permissions: [], plan_type: 'personal', beta_features: [] } },
          },
          notion_user: { 'user_id_1': { value: { id: 'user_id_1', email: 'test@example.com', profile_photo: 'url', name: 'Test User', given_name: '', family_name: '', version: 0 } } },
          block: { // Mock block data for loadSpace
            'page_id_1': { value: { id: 'page_id_1', type: 'page', properties: { title: [['Page 1']] }, collection_id: 'col_id_1', space_id: 'space_id_1'} },
            'page_id_2': { value: { id: 'page_id_2', type: 'collection_view_page', collection_id: 'col_id_2', space_id: 'space_id_2' } }
          },
          collection: { // Mock collection data for loadSpace
            'col_id_2': { value: { id: 'col_id_2', name: [['Collection Page 2']] } }
          }
        },
        pages: ['page_id_1', 'page_id_2'] // for getUserSharedPagesInSpace mock
      } as unknown as NotionUserContent & { pages: string[] }; // Add pages to type for clarity

      // @ts-ignore
      notionService['getUserContent'] = jest.fn().mockResolvedValue(mockUserContentValid);
      // @ts-ignore
      notionService['getRecentPageVisits'] = jest.fn().mockResolvedValue({ recordMap: { collection: mockUserContentValid.recordMap.collection } });

      // Mock the response for requestWithCookie.post call in loadSpace
      // This is a simplified mock; adjust based on actual call structure if needed
      mockedAxios.post.mockImplementation(async (url: string) => {
        if (url.endsWith('getUserSharedPagesInSpace')) {
          return Promise.resolve({ 
            data: { 
              pages: mockUserContentValid.pages,
              recordMap: { 
                block: mockUserContentValid.recordMap.block 
              }
            } 
          });
        }
        // Fallback for other post calls if any during the test
        return Promise.resolve({ data: {} });
      });

      const expectedRepositories: NotionRepository[] = [
        { id: 'page_id_1', name: 'Page 1', groupId: 'space_id_1', groupName: 'Space 1', pageType: 'page' },
        { id: 'col_id_2', name: 'Collection Page 2', groupId: 'space_id_2', groupName: 'Space 2', pageType: 'collection_view_page' },
      ];

      const repositories = await notionService.getRepositories();
      
      expect(repositories).toEqual(expect.arrayContaining(expectedRepositories));
      expect(repositories.length).toBe(expectedRepositories.length);
      expect(mockedAxios.post).toHaveBeenCalledWith(expect.stringContaining('getUserSharedPagesInSpace'), expect.anything());
    });
  });
});
